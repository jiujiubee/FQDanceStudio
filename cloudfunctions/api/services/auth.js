'use strict';
/**
 * 认证与注册。
 * - 身份：OpenID 由云开发运行时注入（getWXContext），是唯一可信身份；无需 AppSecret。
 * - 登录：首次调用 auth.login 时为该 OpenID 创建账户（尚未注册、无任何权限）；
 *   同一微信永远只对应一个账户，角色（roles 数组）挂在该账户上。
 * - 学员注册：填写资料并同意隐私政策后获得 student 角色；或使用绑定码关联前台登记的档案。
 * - 员工：不再使用邀请码。用户注册后，由店主/管理员在「员工管理」中搜索并授予教师/管理员角色。
 * - 首位店主：仅能由部署者在云开发控制台以服务端方式执行一次初始化（见 services/system.js）。
 */
const time = require('../lib/time');
const ids = require('../lib/ids');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const views = require('../lib/views');
const { roleFields, labelOf, isStaff } = require('../lib/roles');
const { refreshSummary } = require('../lib/membership-rules');
const phone = require('../lib/phone');

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

async function nextStudentNo() {
  const d = time.today().replace(/-/g, '').slice(2);
  return `S${d}${ids.shortCode(4)}`;
}

module.exports = {
  async 'auth.login'(ctx) {
    ctx.user = await ensureAccount(ctx);
    await ctx.store.update('users', ctx.user._id, { lastLoginAt: time.now() });
    return sessionView(ctx);
  },

  async 'auth.agreePrivacy'(ctx) {
    if (!ctx.user) throw E.notRegistered();
    const ts = time.now();
    await ctx.store.update('users', ctx.user._id, { privacyAgreedVersion: ctx.settings.privacyPolicyVersion, privacyAgreedAt: ts, updatedAt: ts });
    return { version: ctx.settings.privacyPolicyVersion };
  },

  /**
   * 学员自助注册：获得 student 角色。
   * 手机号必填且必须经过验证（微信手机号快速验证优先，短信验证码兜底）；同一号码不能重复注册。
   * 若管理员已用同一手机号登记过尚未关联微信的档案，则验证通过后自动关联该档案（无需绑定码）。
   */
  async 'auth.registerStudent'(ctx, data) {
    requireConsent(data);
    if (ctx.student) throw E.conflict('ALREADY_REGISTERED', '账户已注册');
    const name = v.str(data.name, '姓名', { max: 30 });
    const wxid = v.str(data.wxid, '微信号', { optional: true, max: 40, pattern: /^[A-Za-z][-_A-Za-z0-9]{5,19}$|^1\d{10}$/ });
    const avatar = v.str(data.avatar, '头像', { optional: true, max: 300, pattern: /^cloud:\/\/[^/]+\/avatars\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/i });
    if (avatar && !avatar.includes(`/avatars/${ctx.userId}/`)) throw E.forbidden('头像文件无效');
    if (!data.phoneCode) phone.validate(data.phone);
    await ensureAccount(ctx);
    const pre = await ctx.store.get('phoneIndex', phone.indexId(phone.normalize(data.phone))).catch(() => null);
    if (!data.phoneCode && pre) {
      const owner = await ctx.store.get('students', pre.studentId);
      if (owner && owner.userId) throw E.conflict('PHONE_EXISTS', phone.DUP_MESSAGE);
    }
    const verified = await phone.verify(ctx, data, ctx.providers);
    const ts = time.now();
    const userId = ctx.userId;
    const idx = await ctx.store.get('phoneIndex', phone.indexId(verified.phone));
    const studentId = idx ? idx.studentId : ids.randomId('stu_');
    const phoneFields = { phone: verified.phone, phoneVerified: true, phoneVerifiedAt: ts, phoneVerifyMethod: verified.method };
    let linked = false;
    await ctx.store.transaction(async (tx) => {
      const u = await tx.get('users', userId);
      if (u.studentId) throw E.conflict('ALREADY_REGISTERED', '账户已注册');
      await phone.claim(tx, verified.phone, studentId);
      const existing = await tx.get('students', studentId);
      if (existing) {
        if (existing.userId || existing.status === 'deleted') throw E.conflict('PHONE_EXISTS', phone.DUP_MESSAGE);
        linked = true;
        await tx.update('students', studentId, {
          userId, name, ...phoneFields, wxid: wxid || existing.wxid || '', avatar: avatar || existing.avatar || '', bindCode: '', updatedAt: ts,
        });
      } else {
        await tx.create('students', {
          _id: studentId, userId, studentNo: await nextStudentNo(), name, ...phoneFields, wxid,
          avatar, gender: '', birthday: '', emergencyContact: '', remark: '', groups: [], status: 'active',
          membershipSummary: { type: 'none', label: '未开卡', remainingCredits: 0, expireDate: '', status: 'none' },
          createdAt: ts, updatedAt: ts,
        });
      }
      await tx.update('users', userId, {
        ...addRole(u, 'student'), studentId, name: u.name || name, wxid: u.wxid || wxid,
        privacyAgreedVersion: ctx.settings.privacyPolicyVersion, privacyAgreedAt: ts, updatedAt: ts,
      });
    });
    if (linked) await refreshSummary(ctx.store, studentId).catch(() => null);
    return { studentId, linked, phoneVerified: true };
  },

  /** 发送短信验证码（微信手机号快速验证不可用时的兜底方式） */
  async 'auth.sendSmsCode'(ctx, data) {
    await ensureAccount(ctx);
    return phone.sendSmsCode(ctx, data.phone, ctx.providers);
  },

  /**
   * 仅完善账户资料（不创建学员档案）。用于将要被授予教师/管理员角色的员工：
   * 注册后出现在「员工管理 → 搜索用户」中，由店主/管理员授权。
   */
  async 'auth.setupAccount'(ctx, data) {
    requireConsent(data);
    const name = v.str(data.name, '姓名', { max: 30 });
    const wxid = v.str(data.wxid, '微信号', { optional: true, max: 40, pattern: /^[A-Za-z][-_A-Za-z0-9]{5,19}$|^1\d{10}$/ });
    await ensureAccount(ctx);
    const ts = time.now();
    await ctx.store.update('users', ctx.userId, {
      name, wxid, privacyAgreedVersion: ctx.settings.privacyPolicyVersion, privacyAgreedAt: ts, updatedAt: ts,
    });
    return { userId: ctx.userId };
  },
};

module.exports.sessionView = sessionView;
module.exports.ensureAccount = ensureAccount;
