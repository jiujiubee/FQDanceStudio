'use strict';
/**
 * 集中式鉴权中间件：
 *  1. 校验 OpenID（来自云函数运行时 getWXContext，客户端无法伪造）
 *  2. 校验账户状态
 *  3. 解析角色
 *  4. 基于可配置权限矩阵校验操作权限
 *  5. 提供资源归属/分配校验辅助方法（ctx.assert*）
 */
const { E } = require('./errors');
const { DEFAULT_MATRIX, FORBIDDEN_FOR_ROLE, ALL, P } = require('./permissions');
const { DEFAULT_SETTINGS } = require('./settings-defaults');
const ids = require('./ids');
const time = require('./time');
const { rolesOf, isStaff } = require('./roles');

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '_id' || k === 'updatedAt' || k === 'updatedBy') continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

async function loadSettings(store) {
  const doc = await store.get('systemSettings', 'global');
  return deepMerge(DEFAULT_SETTINGS, doc);
}

async function loadPermissions(store, role, extra) {
  if (role === 'owner') return new Set(ALL);
  const doc = await store.get('rolePermissions', role);
  const base = doc && Array.isArray(doc.permissions) ? doc.permissions : DEFAULT_MATRIX[role] || [];
  const forbidden = FORBIDDEN_FOR_ROLE[role] || [];
  const set = new Set([...base, ...(extra || [])].filter((p) => ALL.includes(p) && !forbidden.includes(p)));
  return set;
}

async function buildContext(store, openid, opts) {
  if (!openid || typeof openid !== 'string') throw E.unauthenticated();
  const ctx = {
    store,
    openid,
    userId: ids.userIdFromOpenid(openid),
    user: null,
    role: null,
    roles: [],
    registered: false,
    perms: new Set(),
    teacher: null,
    student: null,
    settings: await loadSettings(store),
  };
  const user = await store.get('users', ctx.userId);
  if (user && user.openid === openid && user.status !== 'deleted') {
    ctx.user = user;
    ctx.roles = rolesOf(user);
    ctx.role = ctx.roles[0] || null;
    // 已注册 = 已填写姓名并同意隐私政策；登录时自动创建的账户在注册前没有任何权限
    ctx.registered = !!(user.name && user.privacyAgreedVersion);
    if (user.status === 'suspended' && !(opts && opts.allowSuspended)) throw E.suspended();
    if (user.teacherId) ctx.teacher = await store.get('teachers', user.teacherId);
    if (user.studentId) ctx.student = await store.get('students', user.studentId);
    if (ctx.student && ctx.student.status === 'suspended' && !isStaff(ctx.roles) && !(opts && opts.allowSuspended)) {
      throw E.suspended();
    }
    const teaching = !!(ctx.teacher && ctx.teacher.status === 'active');
    if (!teaching) ctx.teacher = null;
    if (ctx.registered) {
      // 多角色：权限为各角色权限的并集；教师角色仅在教师档案有效时生效
      const perms = new Set();
      for (const role of ctx.roles) {
        if (role === 'teacher' && !teaching) continue;
        const extra = role === 'teacher' ? ctx.teacher.extraPermissions : [];
        for (const p of await loadPermissions(store, role, extra)) perms.add(p);
      }
      ctx.perms = perms;
    }
  }

  ctx.can = (perm) => ctx.perms.has(perm);
  ctx.require = (...perms) => {
    if (!ctx.registered) throw E.notRegistered();
    for (const p of perms) if (!ctx.perms.has(p)) throw E.forbidden();
  };
  ctx.requireAny = (...perms) => {
    if (!ctx.registered) throw E.notRegistered();
    if (!perms.some((p) => ctx.perms.has(p))) throw E.forbidden();
  };
  ctx.requireStudent = () => {
    if (!ctx.registered) throw E.notRegistered();
    if (!ctx.student || ctx.student.status === 'deleted') throw E.forbidden('当前账户未绑定学员档案');
    return ctx.student;
  };
  /** 资源级校验：课程是否可被当前用户访问 */
  ctx.assertClassAccess = (cls) => {
    if (ctx.can(P.CLASS_VIEW_ALL) || ctx.can(P.ATTENDANCE_VIEW_ALL)) return;
    if (ctx.can(P.CLASS_VIEW_ASSIGNED) && ctx.teacher && cls.teacherId === ctx.teacher._id) return;
    throw E.forbidden('只能访问分配给您的课程');
  };
  /** 学员资料访问范围：全部学员 或 教师所授课程中出现的学员 */
  ctx.assertStudentAccess = async (studentId) => {
    if (ctx.can(P.STUDENT_VIEW_ALL)) return;
    if (ctx.student && ctx.student._id === studentId) return;
    if (ctx.can(P.STUDENT_VIEW_BASIC) && ctx.teacher) {
      const att = await store.find('attendance', { studentId, teacherId: ctx.teacher._id }, { limit: 1 });
      if (att.length) return;
      const rosters = await store.find('attendanceRosters', { studentIds: { $contains: studentId } });
      for (const r of rosters) {
        const ref = r.classId ? await store.get('classes', r.classId) : null;
        if (ref && ref.teacherId === ctx.teacher._id) return;
        if (r.seriesId) {
          const one = await store.find('classes', { seriesId: r.seriesId, teacherId: ctx.teacher._id }, { limit: 1 });
          if (one.length) return;
        }
      }
    }
    throw E.forbidden('无权查看该学员信息');
  };
  ctx.audit = (action, targetType, targetId, before, after, reason) =>
    store.create('auditLogs', {
      actorId: ctx.user ? ctx.user._id : null,
      actorRole: ctx.role,
      action,
      targetType,
      targetId,
      before: before === undefined ? null : before,
      after: after === undefined ? null : after,
      reason: reason || '',
      createdAt: time.now(),
      seq: nextAuditSeq(),
    });
  return ctx;
}

let auditSeq = 0;
function nextAuditSeq() {
  auditSeq = (auditSeq + 1) % 1000;
  return time.now() * 1000 + auditSeq;
}

module.exports = { buildContext, loadSettings, loadPermissions, deepMerge };
