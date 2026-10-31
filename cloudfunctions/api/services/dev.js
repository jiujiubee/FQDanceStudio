'use strict';
/**
 * 开发测试工具（仅开发环境）。
 * 只有当云函数环境变量 APP_ENV=development 时才可用；生产环境所有 dev.* 调用与身份模拟参数一律拒绝。
 * 模拟身份使用独立的虚拟 OpenID（devsim:xxx），只存在于开发环境数据库，与真实微信账户互不影响。
 * 所有数据变更写入审计日志。
 */
const time = require('../lib/time');
const ids = require('../lib/ids');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const { roleFields, labelOf, rolesOf } = require('../lib/roles');

const SIM_PREFIX = 'devsim:';
const COLLECTIONS = [
  'users', 'teachers', 'students', 'classes', 'classSeries', 'attendance', 'attendanceRosters',
  'memberships', 'transactions', 'rolePermissions', 'auditLogs', 'systemSettings', 'staffInvites',
];

/** 预置测试账户 */
const TEST_ACCOUNTS = [
  { key: 'owner', name: '测试店主', roles: ['owner', 'teacher'] },
  { key: 'admin', name: '测试管理员', roles: ['admin'] },
  { key: 'teacher', name: '测试教师', roles: ['teacher'] },
  { key: 'teacher2', name: '测试教师二', roles: ['teacher'] },
  { key: 'student', name: '测试学员', roles: ['student'], credits: 10 },
  { key: 'student2', name: '测试学员二', roles: ['student'], credits: 0 },
  { key: 'guest', name: '', roles: [] },
];

const isDev = (env) => !!env && env.APP_ENV === 'development';

function requireDev(ctx) {
  if (!isDev(ctx.env)) throw E.forbidden('开发测试工具仅在开发环境可用');
}

function simOpenid(key) {
  return `${SIM_PREFIX}${ids.safeKey(key)}`;
}

async function wipe(store) {
  let removed = 0;
  for (const c of COLLECTIONS) {
    for (;;) {
      const docs = await store.find(c, {}, { limit: 200 });
      if (!docs.length) break;
      for (const d of docs) await store.remove(c, d._id);
      removed += docs.length;
      if (docs.length < 200) break;
    }
  }
  return removed;
}

async function seed(ctx) {
  const ts = time.now();
  const today = time.today();
  const out = [];
  for (const a of TEST_ACCOUNTS) {
    const openid = simOpenid(a.key);
    const userId = ids.userIdFromOpenid(openid);
    if (await ctx.store.get('users', userId)) continue;
    const user = {
      _id: userId, openid, ...roleFields(a.roles), status: 'active', name: a.name, wxid: a.name ? `test_${a.key}` : '',
      privacyAgreedVersion: a.name ? ctx.settings.privacyPolicyVersion : '', privacyAgreedAt: a.name ? ts : null,
      devSimulated: true, createdAt: ts, updatedAt: ts, lastLoginAt: ts,
    };
    if (a.roles.includes('teacher')) {
      user.teacherId = `tch_${userId}`;
      await ctx.store.create('teachers', { _id: user.teacherId, userId, name: a.name, avatar: '', bio: '', status: 'active', extraPermissions: [], createdAt: ts, updatedAt: ts });
    }
    if (a.roles.includes('student')) {
      user.studentId = `stu_${userId}`;
      await ctx.store.create('students', {
        _id: user.studentId, userId, studentNo: `T${a.key.toUpperCase()}`, name: a.name, phone: '', wxid: user.wxid, avatar: '', gender: '',
        birthday: '', emergencyContact: '', remark: '测试数据', groups: ['测试'], status: 'active',
        membershipSummary: a.credits
          ? { type: 'CLASS_PASS', label: `次卡 剩余${a.credits}次`, remainingCredits: a.credits, expireDate: time.addDays(today, 90), status: 'active' }
          : { type: 'none', label: '未开卡', remainingCredits: 0, expireDate: '', status: 'none' },
        createdAt: ts, updatedAt: ts,
      });
      if (a.credits) {
        const mid = `ms_${userId}`;
        await ctx.store.create('memberships', {
          _id: mid, studentId: user.studentId, type: 'CLASS_PASS', name: `${a.credits}次卡`, totalCredits: a.credits, usedCredits: 0,
          remainingCredits: a.credits, purchaseDate: today, startDate: today, expireDate: time.addDays(today, 90), status: 'active',
          policy: null, usage: {}, priceCents: 0, createdBy: 'dev', createdAt: ts, updatedAt: ts,
        });
        await ctx.store.create('transactions', {
          studentId: user.studentId, membershipId: mid, type: 'purchase', amount: a.credits, previousBalance: 0, newBalance: a.credits,
          operatorId: 'dev', reason: '测试数据', createdAt: ts,
        });
      }
    }
    await ctx.store.create('users', user);
    out.push(a.key);
  }
  // 示例课程：今天起 7 天，每天两节（测试店主、测试教师各一节）
  const owner = await ctx.store.get('users', ids.userIdFromOpenid(simOpenid('owner')));
  const teacher = await ctx.store.get('users', ids.userIdFromOpenid(simOpenid('teacher')));
  let classes = 0;
  for (let i = 0; i < 7; i++) {
    const date = time.addDays(today, i);
    for (const [t, startTime, name] of [[owner, '10:00', '爵士舞基础'], [teacher, '19:00', '韩舞进阶']]) {
      if (!t || !t.teacherId) continue;
      const seriesId = `series_dev_${t.teacherId}`.slice(0, 120);
      const id = ids.classId(seriesId, date);
      if (await ctx.store.get('classes', id)) continue;
      const startAt = time.toMs(date, startTime);
      await ctx.store.create('classes', {
        _id: id, seriesId, name, teacherId: t.teacherId, teacherName: t.name, date, startTime,
        endTime: time.addMinutes(startTime, 60).time, duration: 60, startAt, endAt: startAt + 3600000,
        capacity: null, description: '测试课程', status: 'scheduled', createdBy: 'dev', createdAt: ts, updatedAt: ts,
      });
      classes += 1;
    }
  }
  return { accounts: out, classes };
}

module.exports = {
  /** 列出可切换的测试身份 */
  async 'dev.identities'(ctx) {
    requireDev(ctx);
    const list = [];
    for (const a of TEST_ACCOUNTS) {
      const u = await ctx.store.get('users', ids.userIdFromOpenid(simOpenid(a.key)));
      const roles = rolesOf(u);
      list.push({ key: a.key, name: (u && u.name) || a.name || '未注册访客', roles, roleLabel: labelOf(roles) || '未注册', exists: !!u });
    }
    return { identities: list, current: ctx.simulated ? ctx.simKey : '' };
  },

  /** 生成测试账户与示例课程（幂等） */
  async 'dev.seed'(ctx) {
    requireDev(ctx);
    const r = await seed(ctx);
    await ctx.store.create('auditLogs', {
      actorId: ctx.realUserId || 'dev', actorRole: 'developer', action: 'dev.seed', targetType: 'system', targetId: 'dev',
      before: null, after: r, reason: '开发环境测试数据', createdAt: time.now(),
    });
    return r;
  },

  /** 清空开发环境全部数据并重新生成测试数据 */
  async 'dev.reset'(ctx, data) {
    requireDev(ctx);
    if (data.confirm !== true) throw E.invalid('请确认重置');
    const removed = await wipe(ctx.store);
    const r = data.seed === false ? { accounts: [], classes: 0 } : await seed(ctx);
    await ctx.store.create('auditLogs', {
      actorId: ctx.realUserId || 'dev', actorRole: 'developer', action: 'dev.reset', targetType: 'system', targetId: 'dev',
      before: { removed }, after: r, reason: '重置开发环境数据', createdAt: time.now(),
    });
    return { removed, ...r };
  },

  /** 新增自定义测试身份（未注册），用于测试注册与授权流程 */
  async 'dev.createIdentity'(ctx, data) {
    requireDev(ctx);
    const key = v.str(data.key, '标识', { max: 20, pattern: /^[a-z0-9_]{2,20}$/ });
    return { key, openid: simOpenid(key) };
  },
};

module.exports._isDev = isDev;
module.exports._simOpenid = simOpenid;
module.exports.SIM_PREFIX = SIM_PREFIX;
module.exports.TEST_ACCOUNTS = TEST_ACCOUNTS;
