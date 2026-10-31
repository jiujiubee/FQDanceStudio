'use strict';
const { buildContext } = require('./lib/context');
const { AppError } = require('./lib/errors');

const modules = [
  require('./services/auth'),
  require('./services/profile'),
  require('./services/schedule'),
  require('./services/attendance'),
  require('./services/classes'),
  require('./services/students'),
  require('./services/memberships'),
  require('./services/staff'),
  require('./services/system'),
  require('./services/dev'),
];

const { _isDev: isDev, _simOpenid: simOpenid, SIM_PREFIX } = require('./services/dev');
const ids = require('./lib/ids');

const routes = {};
for (const m of modules) {
  for (const [name, handler] of Object.entries(m)) {
    if (!name.includes('.') || typeof handler !== 'function') continue;
    if (routes[name]) throw new Error(`duplicate route ${name}`);
    routes[name] = handler;
  }
}
// 内部任务（仅服务端/控制台/定时触发器调用，客户端不可调用）
const INTERNAL = new Set(['maintenance.daily', 'system.bootstrapOwner', 'system.migrate']);
// 被停用账户仍可调用的接口（查看状态、导出/注销个人信息）
const ALLOW_SUSPENDED = new Set(['auth.login', 'profile.export', 'profile.deleteAccount']);
// 客户端事件中任何试图覆盖身份/角色的字段一律拒绝（身份只来自 OpenID）
const IDENTITY_OVERRIDE_KEYS = ['openid', 'OPENID', 'userId', 'role', 'roles', 'asRole', 'identity', 'headers'];

function createApi(store, options) {
  options = options || {};
  const env = options.env || process.env;
  return async function handle(event, openid, meta) {
    const action = event && event.action;
    try {
      const handler = Object.prototype.hasOwnProperty.call(routes, action) ? routes[action] : null;
      if (!handler) throw new AppError('UNKNOWN_ACTION', '未知操作', 404);
      const internal = !!(meta && meta.internal);
      if (INTERNAL.has(action) && !internal) throw new AppError('FORBIDDEN', '没有权限执行该操作', 403);
      if (IDENTITY_OVERRIDE_KEYS.some((k) => event[k] !== undefined)) throw new AppError('FORBIDDEN', '不允许指定身份或角色', 403);

      // 开发环境角色模拟：仅 APP_ENV=development 时生效；生产环境携带 devAs 直接拒绝
      let effective = internal ? '__system__' : openid;
      let simKey = '';
      if (event.devAs !== undefined && event.devAs !== null && event.devAs !== '') {
        if (!isDev(env)) throw new AppError('FORBIDDEN', '生产环境不允许模拟身份', 403);
        if (internal || !openid) throw new AppError('FORBIDDEN', '没有权限执行该操作', 403);
        simKey = ids.safeKey(event.devAs).slice(0, 20);
        if (!simKey) throw new AppError('INVALID_ARGUMENT', '模拟身份无效', 400);
        effective = simOpenid(simKey);
      } else if (!internal && typeof openid === 'string' && openid.startsWith(SIM_PREFIX)) {
        throw new AppError('UNAUTHENTICATED', '登录状态无效，请重新登录', 401);
      }
      const ctx = await buildContext(store, effective, { allowSuspended: ALLOW_SUSPENDED.has(action) });
      ctx.env = env;
      ctx.providers = options.providers || {};
      ctx.internal = internal;
      ctx.devMode = isDev(env);
      ctx.simulated = !!simKey;
      ctx.simKey = simKey;
      ctx.realUserId = openid && !internal ? ids.userIdFromOpenid(openid) : '';
      const data = await handler(ctx, (event && event.data) || {});
      return { ok: true, data: data === undefined ? null : data };
    } catch (e) {
      if (e instanceof AppError) return { ok: false, code: e.code, message: e.message };
      if (options.logger !== false) console.error('[api]', action, e);
      return { ok: false, code: 'INTERNAL', message: '服务繁忙，请稍后再试' };
    }
  };
}

module.exports = { createApi, routes };
