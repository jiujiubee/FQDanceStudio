'use strict';
/**
 * 员工与角色管理（多角色模型，不使用邀请码）。
 * 流程：用户用微信登录并注册 → 店主/管理员在「员工管理」搜索该用户 → 授予教师/管理员/店主角色。
 * 层级规则：
 *  - 授予/撤销教师：teacher.manage（管理员、店主）
 *  - 授予/撤销管理员：admin.manage（仅店主）
 *  - 授予/撤销店主：owner.manage（仅店主），且不能撤销最后一位店主
 *  - 任何人不能修改自己的角色；唯一例外：店主可为自己开通/关闭教师身份（店主本身拥有全部权限，不构成提权）
 * 撤销教师角色只停用教师档案，历史课程与签到记录全部保留。
 */
const time = require('../lib/time');
const { E } = require('../lib/errors');
const { v, escapeRegex } = require('../lib/validate');
const { P, ALL, FORBIDDEN_FOR_ROLE } = require('../lib/permissions');
const { rolesOf, roleFields, labelOf, ROLE_LABEL, STAFF_ROLES } = require('../lib/roles');

const PERM_FOR_ROLE = { teacher: P.TEACHER_MANAGE, admin: P.ADMIN_MANAGE, owner: P.OWNER_MANAGE };
/** 教师档案主键由用户 ID 确定性生成：同一用户永远只有一份教师档案 */
const teacherIdFor = (userId) => `tch_${userId}`;

function requireRoleAuthority(ctx, role) {
  const perm = PERM_FOR_ROLE[role];
  if (!perm) throw E.invalid('角色错误');
  ctx.require(perm);
}

function assertMayChange(ctx, target, role) {
  requireRoleAuthority(ctx, role);
  if (target._id === ctx.user._id && !(role === 'teacher' && ctx.roles.includes('owner'))) {
    throw E.forbidden('不能修改自己的角色');
  }
}

async function loadTarget(ctx, userId) {
  const u = await ctx.store.get('users', v.id(userId, '用户'));
  if (!u || u.status === 'deleted') throw E.notFound('用户');
  if (!u.name || !u.privacyAgreedVersion) throw E.rule('NOT_REGISTERED', '该用户尚未完成注册');
  return u;
}

function userView(ctx, u, tMap) {
  const roles = rolesOf(u);
  const t = u.teacherId ? tMap.get(u.teacherId) : null;
  const self = u._id === ctx.user._id;
  return {
    userId: u._id, name: u.name, wxid: u.wxid || '', roles, roleLabel: labelOf(roles) || '未授权', status: u.status,
    teacherId: t && t.status === 'active' ? t._id : '', teaching: !!(t && t.status === 'active'), avatar: t ? t.avatar || '' : '',
    extraPermissions: t ? t.extraPermissions || [] : [],
    isSelf: self,
    grantable: STAFF_ROLES.filter((r) => !roles.includes(r) && ctx.can(PERM_FOR_ROLE[r]) && (!self || (r === 'teacher' && ctx.roles.includes('owner')))),
    revocable: STAFF_ROLES.filter((r) => roles.includes(r) && ctx.can(PERM_FOR_ROLE[r]) && (!self || (r === 'teacher' && ctx.roles.includes('owner')))),
  };
}

async function teacherMap(store, users) {
  const tids = users.map((u) => u.teacherId).filter(Boolean);
  const list = tids.length ? await store.find('teachers', { _id: { $in: tids } }) : [];
  return new Map(list.map((t) => [t._id, t]));
}

async function countOwners(store) {
  const users = await store.find('users', { roles: { $contains: 'owner' }, status: 'active' });
  return users.length;
}

/** 授予/撤销角色（事务内完成：角色数组 + 教师档案） */
async function changeRole(ctx, target, role, grant, reason) {
  const ts = time.now();
  const before = rolesOf(target);
  let after = before;
  await ctx.store.transaction(async (tx) => {
    const u = await tx.get('users', target._id);
    const cur = rolesOf(u);
    if (grant && cur.includes(role)) throw E.conflict('ROLE_EXISTS', `该用户已是${ROLE_LABEL[role]}`);
    if (!grant && !cur.includes(role)) throw E.conflict('ROLE_MISSING', `该用户不是${ROLE_LABEL[role]}`);
    after = roleFields(grant ? [...cur, role] : cur.filter((r) => r !== role)).roles;
    const patch = { ...roleFields(after), updatedAt: ts };
    if (role === 'teacher') {
      const tid = u.teacherId || teacherIdFor(u._id);
      const t = await tx.get('teachers', tid);
      if (grant) {
        if (t) await tx.update('teachers', tid, { status: 'active', name: t.name || u.name, updatedAt: ts });
        else {
          await tx.create('teachers', {
            _id: tid, userId: u._id, name: u.name, avatar: '', bio: '', status: 'active', extraPermissions: [], createdAt: ts, updatedAt: ts,
          });
        }
        patch.teacherId = tid;
      } else if (t) {
        await tx.update('teachers', tid, { status: 'revoked', updatedAt: ts });
      }
    }
    await tx.update('users', u._id, patch);
  });
  if (!grant && role === 'owner' && (await countOwners(ctx.store)) < 1) {
    // 并发撤销导致没有店主时回滚
    await ctx.store.update('users', target._id, { ...roleFields(before), updatedAt: time.now() });
    throw E.rule('LAST_OWNER', '不能移除最后一位店主');
  }
  await ctx.audit(grant ? 'role.grant' : 'role.revoke', 'user', target._id, { roles: before }, { roles: after, role }, reason || '');
  return { roles: after };
}

module.exports = {
  /** 按姓名或微信号搜索已注册用户（用于授予员工角色） */
  async 'staff.searchUsers'(ctx, data) {
    ctx.requireAny(P.TEACHER_MANAGE, P.ADMIN_MANAGE, P.OWNER_MANAGE);
    const keyword = v.str(data.keyword, '关键词', { max: 30 });
    const re = escapeRegex(keyword);
    const users = await ctx.store.find('users', {
      status: { $in: ['active', 'suspended'] },
      $or: [{ name: { $regex: re } }, { wxid: { $regex: re } }],
    }, { limit: 30 });
    const registered = users.filter((u) => u.name && u.privacyAgreedVersion);
    const tMap = await teacherMap(ctx.store, registered);
    return registered.map((u) => userView(ctx, u, tMap));
  },

  async 'staff.list'(ctx) {
    ctx.requireAny(P.TEACHER_MANAGE, P.ADMIN_MANAGE, P.OWNER_MANAGE);
    const users = await ctx.store.find('users', { role: { $in: STAFF_ROLES }, status: { $in: ['active', 'suspended'] } });
    const tMap = await teacherMap(ctx.store, users);
    const items = users.map((u) => userView(ctx, u, tMap));
    const rank = (x) => ['owner', 'admin', 'teacher'].indexOf(x.roles[0]);
    items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-CN'));
    return items;
  },

  async 'staff.grantRole'(ctx, data) {
    const role = v.oneOf(data.role, '角色', STAFF_ROLES);
    requireRoleAuthority(ctx, role);
    const target = await loadTarget(ctx, data.userId);
    assertMayChange(ctx, target, role);
    if (target.status !== 'active') throw E.rule('ACCOUNT_SUSPENDED', '该账户已停用');
    return changeRole(ctx, target, role, true, v.str(data.reason, '原因', { optional: true, max: 200 }));
  },

  async 'staff.revokeRole'(ctx, data) {
    const role = v.oneOf(data.role, '角色', STAFF_ROLES);
    requireRoleAuthority(ctx, role);
    const target = await loadTarget(ctx, data.userId);
    assertMayChange(ctx, target, role);
    if (role === 'owner' && rolesOf(target).includes('owner') && (await countOwners(ctx.store)) <= 1) {
      throw E.rule('LAST_OWNER', '不能移除最后一位店主');
    }
    return changeRole(ctx, target, role, false, v.str(data.reason, '原因', { optional: true, max: 200 }));
  },

  /** 为个别教师授予额外权限（如查看全部课程），仅店主 */
  async 'staff.setTeacherPermissions'(ctx, data) {
    ctx.require(P.PERMISSION_MANAGE);
    const teacherId = v.id(data.teacherId, '教师');
    const t = await ctx.store.get('teachers', teacherId);
    if (!t) throw E.notFound('教师');
    if (!Array.isArray(data.permissions)) throw E.invalid('权限格式错误');
    const forbidden = FORBIDDEN_FOR_ROLE.teacher;
    const perms = [...new Set(data.permissions)].filter((p) => ALL.includes(p));
    if (perms.some((p) => forbidden.includes(p))) throw E.invalid('包含教师不可拥有的权限');
    await ctx.store.update('teachers', teacherId, { extraPermissions: perms, updatedAt: time.now() });
    await ctx.audit('teacher.permissions', 'teacher', teacherId, { extraPermissions: t.extraPermissions || [] }, { extraPermissions: perms }, '');
    return { permissions: perms };
  },
};

module.exports._teacherIdFor = teacherIdFor;
module.exports._countOwners = countOwners;
