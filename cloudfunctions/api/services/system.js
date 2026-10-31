'use strict';
/** 系统设置、权限矩阵、审计日志、每日维护任务 */
const time = require('../lib/time');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const { P, ALL, DEFAULT_MATRIX, FORBIDDEN_FOR_ROLE } = require('../lib/permissions');
const rules = require('../lib/membership-rules');
const phoneLib = require('../lib/phone');
const { rolesOf, roleFields } = require('../lib/roles');
const { escapeRegex } = require('../lib/validate');

const BOOTSTRAP_LOCK = 'bootstrap-lock';

async function hasOwner(store) {
  const list = await store.find('users', { roles: { $contains: 'owner' }, status: 'active' }, { limit: 1 });
  if (list.length) return true;
  // 兼容迁移前的单角色数据
  return (await store.count('users', { role: 'owner', status: 'active' })) > 0;
}

module.exports = {
  async 'settings.get'(ctx) {
    ctx.requireAny(P.SETTINGS_MANAGE, P.POLICY_MANAGE, P.MEMBERSHIP_MANAGE, P.CLASS_MANAGE);
    return ctx.settings;
  },

  async 'settings.update'(ctx, data) {
    const patch = {};
    if (data.studioName !== undefined || data.checkin !== undefined || data.privacyPolicyVersion !== undefined) {
      ctx.require(P.SETTINGS_MANAGE);
      if (data.studioName !== undefined) patch.studioName = v.str(data.studioName, '工作室名称', { max: 40 });
      if (data.privacyPolicyVersion !== undefined) patch.privacyPolicyVersion = v.str(data.privacyPolicyVersion, '隐私政策版本', { max: 20 });
      if (data.checkin) {
        patch.checkin = {
          openBeforeMinutes: v.int(data.checkin.openBeforeMinutes, '提前签到分钟', { min: 0, max: 720 }),
          closeAfterStartMinutes: v.int(data.checkin.closeAfterStartMinutes, '开课后签到分钟', { min: 0, max: 480 }),
        };
      }
    }
    if (data.membership !== undefined) {
      ctx.require(P.POLICY_MANAGE);
      const m = data.membership;
      patch.membership = {
        ...ctx.settings.membership,
        monthlyDefaultMode: v.oneOf(m.monthlyDefaultMode, '月卡默认策略', ['unlimited', 'limited']),
        monthlyDefaultLimit: v.int(m.monthlyDefaultLimit, '月卡默认次数', { min: 1, max: 100 }),
        refundOnCancel: !!m.refundOnCancel,
        passDefaultValidDays: v.int(m.passDefaultValidDays, '次卡默认有效期', { min: 1, max: 1000 }),
      };
      if (Array.isArray(m.passPresets)) patch.membership.passPresets = m.passPresets.slice(0, 8).map((n) => v.int(n, '次卡规格', { min: 1, max: 500 }));
    }
    if (!Object.keys(patch).length) throw E.invalid('没有需要更新的设置');
    const before = await ctx.store.get('systemSettings', 'global');
    await ctx.store.set('systemSettings', 'global', { ...(before || {}), ...patch, _id: 'global', updatedBy: ctx.user._id, updatedAt: time.now() });
    await ctx.audit('settings.update', 'systemSettings', 'global', before || null, patch, '');
    return { updated: true };
  },

  async 'permissions.get'(ctx) {
    ctx.require(P.PERMISSION_MANAGE);
    const out = {};
    for (const role of ['admin', 'teacher', 'student']) {
      const doc = await ctx.store.get('rolePermissions', role);
      out[role] = { permissions: doc ? doc.permissions : DEFAULT_MATRIX[role], forbidden: FORBIDDEN_FOR_ROLE[role], customized: !!doc };
    }
    return { all: ALL, roles: out };
  },

  async 'permissions.update'(ctx, data) {
    ctx.require(P.PERMISSION_MANAGE);
    const role = v.oneOf(data.role, '角色', ['admin', 'teacher', 'student']);
    if (data.reset) {
      await ctx.store.remove('rolePermissions', role);
      await ctx.audit('permissions.reset', 'rolePermissions', role, null, null, '');
      return { reset: true };
    }
    if (!Array.isArray(data.permissions)) throw E.invalid('权限格式错误');
    const perms = [...new Set(data.permissions)];
    if (perms.some((p) => !ALL.includes(p))) throw E.invalid('包含未知权限');
    if (perms.some((p) => FORBIDDEN_FOR_ROLE[role].includes(p))) throw E.invalid('包含该角色不可拥有的权限');
    const before = await ctx.store.get('rolePermissions', role);
    await ctx.store.set('rolePermissions', role, { permissions: perms, updatedBy: ctx.user._id, updatedAt: time.now() });
    await ctx.audit('permissions.update', 'rolePermissions', role, before ? before.permissions : DEFAULT_MATRIX[role], perms, '');
    return { permissions: perms };
  },

  async 'audit.list'(ctx, data) {
    ctx.require(P.AUDIT_VIEW);
    const page = v.int(data.page, '页码', { optional: true, default: 0, min: 0 });
    const where = {};
    if (data.targetType) where.targetType = v.str(data.targetType, '对象类型', { max: 40 });
    if (data.targetId) where.targetId = v.str(data.targetId, '对象', { max: 128 });
    const list = await ctx.store.find('auditLogs', where, { orderBy: [['createdAt', 'desc'], ['seq', 'desc']], skip: page * 30, limit: 31 });
    const uids = [...new Set(list.map((l) => l.actorId).filter(Boolean))];
    const users = uids.length ? await ctx.store.find('users', { _id: { $in: uids } }) : [];
    const un = new Map(users.map((u) => [u._id, u.name]));
    return {
      items: list.slice(0, 30).map((l) => ({ ...l, actorName: l.actorId === 'system' ? '系统' : un.get(l.actorId) || '' })),
      hasMore: list.length > 30,
    };
  },

  /**
   * 首位店主初始化（仅服务端）。
   * 只能在云开发控制台「云函数 → api → 云端测试」中调用（无用户 OpenID 的服务端调用），
   * 小程序客户端调用一律拒绝。执行成功后写入永久锁，此后即使店主被全部移除也不可再次执行。
   * 不使用任何口令/密钥，安全性来自「只有小程序管理员可以登录云开发控制台」。
   * data: { userId } 或 { keyword: 姓名/微信号 }
   */
  async 'system.bootstrapOwner'(ctx, data) {
    if (!ctx.internal) throw E.forbidden();
    if (await ctx.store.get('systemSettings', BOOTSTRAP_LOCK)) throw E.forbidden('系统已初始化，初始化操作已永久停用');
    if (await hasOwner(ctx.store)) throw E.forbidden('系统已存在店主，初始化操作已永久停用');
    let target;
    if (data.userId) {
      target = await ctx.store.get('users', v.id(data.userId, '用户'));
    } else {
      const kw = escapeRegex(v.str(data.keyword, '姓名或微信号', { max: 30 }));
      const found = (await ctx.store.find('users', { status: 'active', $or: [{ name: { $regex: `^${kw}$` } }, { wxid: { $regex: `^${kw}$` } }] }, { limit: 10 }))
        .filter((u) => u.name && u.privacyAgreedVersion);
      if (found.length > 1) {
        return { ok: false, message: '匹配到多个用户，请使用 userId 重新执行', candidates: found.map((u) => ({ userId: u._id, name: u.name, wxid: u.wxid || '', createdAt: u.createdAt })) };
      }
      target = found[0];
    }
    if (!target || target.status !== 'active' || !target.name || !target.privacyAgreedVersion) {
      throw E.notFound('已注册用户（请先用店主本人微信打开小程序完成注册）');
    }
    const ts = time.now();
    await ctx.store.transaction(async (tx) => {
      // 锁文档主键唯一：并发执行只有一次成功
      await tx.create('systemSettings', { _id: BOOTSTRAP_LOCK, ownerUserId: target._id, createdAt: ts });
      const u = await tx.get('users', target._id);
      await tx.update('users', target._id, { ...roleFields([...rolesOf(u), 'owner']), updatedAt: ts });
    }).catch((e) => {
      if (e.code === 'DUPLICATE') throw E.forbidden('系统已初始化');
      throw e;
    });
    await ctx.store.create('auditLogs', {
      actorId: 'system', actorRole: 'system', action: 'owner.bootstrap', targetType: 'user', targetId: target._id,
      before: { roles: rolesOf(target) }, after: { roles: roleFields([...rolesOf(target), 'owner']).roles }, reason: '系统初始化（控制台执行）', createdAt: ts,
    });
    return { ok: true, userId: target._id, name: target.name };
  },

  /** 数据迁移（仅服务端，可重复执行）：v1 单角色 role → v2 多角色 roles；废弃未使用的员工邀请码 */
  async 'system.migrate'(ctx) {
    if (!ctx.internal) throw E.forbidden();
    const users = await ctx.store.find('users', {});
    let migrated = 0;
    for (const u of users) {
      if (Array.isArray(u.roles)) continue;
      await ctx.store.update('users', u._id, { ...roleFields(rolesOf(u)), wxid: u.wxid || '', updatedAt: time.now() });
      migrated += 1;
    }
    const invites = await ctx.store.find('staffInvites', { status: 'active' }).catch(() => []);
    for (const i of invites) await ctx.store.update('staffInvites', i._id, { status: 'revoked' });
    // v3：会员类型显式枚举（pass→CLASS_PASS，monthly→MONTHLY），字段语义不变
    const legacy = await ctx.store.find('memberships', { type: { $in: ['pass', 'monthly'] } });
    for (const m of legacy) {
      await ctx.store.update('memberships', m._id, { type: rules.canonType(m.type), usedCredits: m.usedCredits || 0, updatedAt: time.now() });
    }
    // v3：手机号唯一索引；已有学员手机号标记为未验证；重复号码保留首个并报告
    const students = await ctx.store.find('students', { status: { $in: ['active', 'suspended'] } });
    const phoneConflicts = [];
    for (const s of students) {
      const p = phoneLib.normalize(s.phone);
      if (s.phoneVerified === undefined) await ctx.store.update('students', s._id, { phoneVerified: false, phoneVerifiedAt: null, phoneVerifyMethod: '' });
      if (!p || !phoneLib.PHONE_RE.test(p)) continue;
      try {
        await ctx.store.transaction((tx) => phoneLib.claim(tx, p, s._id));
      } catch (e) {
        phoneConflicts.push(s._id);
      }
    }
    if (await hasOwner(ctx.store) && !(await ctx.store.get('systemSettings', BOOTSTRAP_LOCK))) {
      await ctx.store.create('systemSettings', { _id: BOOTSTRAP_LOCK, ownerUserId: '', createdAt: time.now(), reason: 'migrate' }).catch(() => null);
    }
    await ctx.store.create('auditLogs', {
      actorId: 'system', actorRole: 'system', action: 'system.migrate', targetType: 'system', targetId: 'roles-v2',
      before: null, after: { users: migrated, invitesRevoked: invites.length, memberships: legacy.length, phoneConflicts }, reason: '', createdAt: time.now(),
    });
    return { migratedUsers: migrated, invitesRevoked: invites.length, migratedMemberships: legacy.length, phoneConflicts };
  },

  /** 定时任务：标记过期会员卡并写入「过期」流水（剩余课时清零记账） */
  async 'maintenance.daily'(ctx) {
    if (!ctx.internal) throw E.forbidden();
    const today = time.today();
    const expired = await ctx.store.find('memberships', { status: 'active', expireDate: { $lt: today } });
    const students = new Set();
    for (const m of expired) {
      await ctx.store.transaction(async (tx) => {
        const cur = await tx.get('memberships', m._id);
        if (!cur || cur.status !== 'active' || cur.expireDate >= today) return;
        await tx.update('memberships', m._id, { status: 'expired', updatedAt: time.now() });
        await rules.writeTx(tx, {
          studentId: cur.studentId, membershipId: cur._id, type: 'expiration',
          amount: rules.usesCredits(cur) ? -(cur.remainingCredits || 0) : 0,
          previousBalance: cur.remainingCredits || 0, newBalance: 0,
          operatorId: 'system', reason: `会员卡到期（${cur.expireDate}）`, refType: 'membership', refId: cur._id,
        });
        if (rules.usesCredits(cur) && cur.remainingCredits > 0) {
          await tx.update('memberships', m._id, { expiredCredits: cur.remainingCredits, remainingCredits: 0 });
        }
      });
      students.add(m.studentId);
    }
    for (const sid of students) await rules.refreshSummary(ctx.store, sid).catch(() => null);
    await ctx.store.create('auditLogs', {
      actorId: 'system', actorRole: 'system', action: 'maintenance.daily', targetType: 'system', targetId: 'daily',
      before: null, after: { expired: expired.length }, reason: '', createdAt: time.now(),
    });
    return { expired: expired.length };
  },
};
