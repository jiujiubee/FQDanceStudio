'use strict';
/**
 * 认证与注册。
 * - 身份：OpenID 由云开发运行时注入（getWXContext），是唯一可信身份；无需 AppSecret。
 * - 登录：首次调用 auth.login 时为该 OpenID 创建账户（尚未注册、无任何权限）；
 *   同一微信永远只对应一个账户，角色（roles 数组）挂在该账户上。
 （姓名必填，微信号/头像选填，注册不收集、不验证手机号）
 * - 教师：不再有独立的教师注册/邀请码。店主在「学员管理 → 学员详情」中直接「设为老师」。
 * - 自愈：历史上通过旧版「员工注册」完成注册但没有学员档案的账户，登录时自动补建学员档案。
 * - 首位店主：仅能由部署者在云开发控制台以服务端方式执行一次初始化（见 services/system.js）。
 */
const time = require('../lib/time');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const views = require('../lib/views');
const { hasLegacyAdmin, roleFields, labelOf, isStaff } = require('../lib/roles');
const { buildContext } = require('../lib/context');

const EMPTY_SUMMARY = { type: 'none', label: '未开卡', remainingCredits: 0, expireDate: '', status: 'none' };

/**
 * 为已注册但缺少学员档案的账户补建档案（幂等：主键由 userId 确定性生成，并在事务中校验 users.studentId）。
 * 返回是否新建。
 */
async function ensureStudentProfile(store, user) {
  if (!user || user.studentId || !user.name || !user.privacyAgreedVersion || user.status === 'deleted') return false;
  // 未迁移的旧 ADMIN 账号先由 system.migrate 处理角色，避免覆盖其旧角色数据
  if (hasLegacyAdmin(user) || !Array.isArray(user.roles)) return false;
  const studentId = `stu_${user._id}`;
  const ts = time.now();
  let created = false;
  await store.transaction(async (tx) => {
    const u = await tx.get('users', user._id);
    if (!u || u.studentId) return;
    const existing = await tx.get('students', studentId);
    if (!existing) {
      await tx.create('students', {
        _id: studentId, userId: u._id, name: u.name, phone: '', phoneVerified: false, phoneVerifiedAt: null, phoneVerifyMethod: '',
        wxid: u.wxid || '', avatar: '', gender: '', birthday: '', emergencyContact: '', remark: '', groups: [], status: 'active',
        membershipSummary: { ...EMPTY_SUMMARY }, createdAt: ts, updatedAt: ts,
      });
      created = true;
    } else if (existing.status === 'deleted') return;
    await tx.update('users', u._id, { ...addRole(u, 'student'), studentId, updatedAt: ts });
  });
  return created;
}

function sessionView(ctx) {
  const base = {
    privacyPolicyVersion: ctx.settings.privacyPolicyVersion,
    studioName: ctx.settings.studioName,
    devMode: !!ctx.devMode,
    simulated: !!ctx.simulated,
  };
  if (!ctx.user || !ctx.registered) {
    return { ...base, registered: false, userId: ctx.user ? ctx.user._id : '', role: null, roles: [], name: ctx.user ? ctx.user.name || '' : '' };
  }
  return {
    ...base,
    registered: true,
    userId: ctx.user._id,
    role: ctx.role,
    roles: ctx.roles,
    roleLabel: labelOf(ctx.roles),
    isStaff: isStaff(ctx.roles),
    status: ctx.user.status,
    name: ctx.user.name,
    permissions: [...ctx.perms],
    student: views.studentForSelf(ctx.student),
    teacher: ctx.teacher ? { _id: ctx.teacher._id, name: ctx.teacher.name, avatar: ctx.teacher.avatar || '', status: ctx.teacher.status } : null,
    privacyAgreed: ctx.user.privacyAgreedVersion === ctx.settings.privacyPolicyVersion,
  };
}

function requireConsent(data) {
  if (data.agreePrivacy !== true) throw E.invalid('请先阅读并同意《隐私政策》与《用户服务协议》');
}

/** 首次登录时创建账户（幂等：_id 由 OpenID 确定性生成） */
async function ensureAccount(ctx) {
  if (ctx.user) return ctx.user;
  const ts = time.now();
  const doc = {
    _id: ctx.userId, openid: ctx.openid, ...roleFields([]), status: 'active', name: '', wxid: '',
    privacyAgreedVersion: '', privacyAgreedAt: null, createdAt: ts, updatedAt: ts, lastLoginAt: ts,
  };
  try {
    await ctx.store.create('users', doc);
  } catch (e) {
    if (e.code !== 'DUPLICATE') throw e;
    return ctx.store.get('users', ctx.userId);
  }
  return doc;
}

function addRole(user, role) {
  const roles = Array.isArray(user && user.roles) ? user.roles : [];
  return roleFields([...roles, role]);
}

module.exports = {
  async 'auth.login'(ctx) {
    ctx.user = await ensureAccount(ctx);
    await ctx.store.update('users', ctx.user._id, { lastLoginAt: time.now() });
    if (ctx.registered && !ctx.user.studentId && ctx.user.status === 'active') {
      await ensureStudentProfile(ctx.store, ctx.user);
      const fresh = await buildContext(ctx.store, ctx.openid, { allowSuspended: true });
      return sessionView({ ...fresh, devMode: ctx.devMode, simulated: ctx.simulated });
    }
    return sessionView(ctx);
  },

  async 'auth.agreePrivacy'(ctx) {
    if (!ctx.user) throw E.notRegistered();
    const ts = time.now();
    await ctx.store.update('users', ctx.user._id, { privacyAgreedVersion: ctx.settings.privacyPolicyVersion, privacyAgreedAt: ts, updatedAt: ts });
    return { version: ctx.settings.privacyPolicyVersion };
  },

  /**
   * 学员自助注册：仅依赖 OpenID；姓名必填，微信号/头像选填。注册不收集、不校验手机号，
   * 手机号作为学员资料中的选填项，由学员在个人资料或店主在学员管理中手动填写。
   * 学员档案主键为 stu_<userId>，与 OpenID 派生的账户一一对应，保证不会重复创建。
   */
  async 'auth.registerStudent'(ctx, data) {
    requireConsent(data);
    if (ctx.student) throw E.conflict('ALREADY_REGISTERED', '账户已注册');
    const name = v.str(data.name, '姓名', { max: 30 });
    const wxid = v.str(data.wxid, '微信号', { optional: true, max: 40, pattern: /^[A-Za-z][-_A-Za-z0-9]{5,19}$|^1\d{10}$/ });
    const avatar = v.str(data.avatar, '头像', { optional: true, max: 300, pattern: /^cloud:\/\/[^/]+\/avatars\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/i });
    if (avatar && !avatar.includes(`/avatars/${ctx.userId}/`)) throw E.forbidden('头像文件无效');
    await ensureAccount(ctx);
    const ts = time.now();
    const userId = ctx.userId;
    // 主键由账户确定性生成：重复提交/并发注册不会产生多个学员档案
    const studentId = `stu_${userId}`;
    await ctx.store.transaction(async (tx) => {
      const u = await tx.get('users', userId);
      if (u.studentId) throw E.conflict('ALREADY_REGISTERED', '账户已注册');
      const existing = await tx.get('students', studentId);
      if (existing && existing.status === 'deleted') throw E.conflict('ALREADY_REGISTERED', '账户已注销，请联系店主');
      if (existing) {
        // 保留已有手机号等资料，只补充本次提交的字段
        await tx.update('students', studentId, { userId, name, wxid: wxid || existing.wxid || '', avatar: avatar || existing.avatar || '', updatedAt: ts });
      } else {
        await tx.create('students', {
          _id: studentId, userId, name, phone: '', phoneVerified: false, phoneVerifiedAt: null, phoneVerifyMethod: '', wxid,
          avatar, gender: '', birthday: '', emergencyContact: '', remark: '', groups: [], status: 'active',
          membershipSummary: { ...EMPTY_SUMMARY },
          createdAt: ts, updatedAt: ts,
        });
      }
      await tx.update('users', userId, {
        ...addRole(u, 'student'), studentId, name: u.name || name, wxid: u.wxid || wxid,
        privacyAgreedVersion: ctx.settings.privacyPolicyVersion, privacyAgreedAt: ts, updatedAt: ts,
      });
    });
    return { studentId, linked: false };
  },
};

  module.exports.sessionView = sessionView;
  module.exports.ensureAccount = ensureAccount;
  module.exports.ensureStudentProfile = ensureStudentProfile;
