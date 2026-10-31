'use strict';
/** 个人资料、头像、个人信息导出与注销（PIPL 个人信息权利） */
const time = require('../lib/time');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const views = require('../lib/views');
const { P } = require('../lib/permissions');
const phoneLib = require('../lib/phone');
const { _countOwners: countOwners } = require('./staff');

/** 只接受本人目录下的云存储文件，防止引用他人文件 */
function validateAvatar(ctx, fileID) {
  if (!fileID) return '';
  const s = v.str(fileID, '头像', { max: 300 });
  if (!/^cloud:\/\/[^/]+\/avatars\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(s)) throw E.invalid('头像文件无效');
  if (!s.includes(`/avatars/${ctx.user._id}/`)) throw E.forbidden('头像文件无效');
  return s;
}

module.exports = {
  async 'profile.get'(ctx) {
    if (!ctx.registered) throw E.notRegistered();
    return {
      name: ctx.user.name,
      role: ctx.role,
      roles: ctx.roles,
      wxid: ctx.user.wxid || '',
      student: views.studentForSelf(ctx.student),
      teacher: ctx.teacher ? { _id: ctx.teacher._id, name: ctx.teacher.name, avatar: ctx.teacher.avatar || '', bio: ctx.teacher.bio || '' } : null,
    };
  },

  async 'profile.update'(ctx, data) {
    ctx.require(P.SELF_PROFILE);
    const ts = time.now();
    const name = data.name !== undefined ? v.str(data.name, '姓名', { max: 30 }) : undefined;
    const avatar = data.avatar !== undefined ? validateAvatar(ctx, data.avatar) : undefined;
    if (ctx.student) {
      const patch = { updatedAt: ts };
      if (name !== undefined) patch.name = name;
      if (avatar !== undefined) patch.avatar = avatar;
      if (data.wxid !== undefined) patch.wxid
      if (data.gender !== undefined) patch.gender = v.oneOf(data.gender, '性别', ['', 'male', 'female']);
      if (data.birthday !== undefined) patch.birthday = v.date(data.birthday, '生日', { optional: true });
      if (data.emergencyContact !== undefined) patch.emergencyContact = v.str(data.emergencyContact, '紧急联系人', { optional: true, max: 60 });
      await ctx.store.update('students', ctx.student._id, patch);
      if (data.phone !== undefined || data.phoneCode) {
        const sid = ctx.student._id;
        const old = ctx.student.phone;
        if (data.phoneCode || phoneLib.normalize(data.phone) !== old) {
          const verified = await phoneLib.verify(ctx, data, ctx.providers);
          await ctx.store.transaction(async (tx) => {
            await phoneLib.claim(tx, verified.phone, sid);
            if (old !== verified.phone) await phoneLib.release(tx, old, sid);
            await tx.update('students', sid, { phone: verified.phone, phoneVerified: true, phoneVerifiedAt: ts, phoneVerifyMethod: verified.method });
          });
        }
      }
    }
    if (ctx.teacher) {
      const patch = { updatedAt: ts };
      if (name !== undefined) patch.name = name;
      if (avatar !== undefined) patch.avatar = avatar;
      if (data.bio !== undefined) patch.bio = v.str(data.bio, '简介', { optional: true, max: 300 });
      await ctx.store.update('teachers', ctx.teacher._id, patch);
    }
    if (name !== undefined) await ctx.store.update('users', ctx.user._id, { name, updatedAt: ts });
    return { updated: true };
  },

  /** 个人信息副本（PIPL 第四十五条） */
  async 'profile.export'(ctx) {
    if (!ctx.user) throw E.notRegistered();
    const out = { account: { roles: ctx.roles, name: ctx.user.name, wxid: ctx.user.wxid || '', createdAt: ctx.user.createdAt, privacyAgreedAt: ctx.user.privacyAgreedAt } };
    if (ctx.student) {
      out.student = views.studentForSelf(ctx.student);
      out.memberships = (await ctx.store.find('memberships', { studentId: ctx.student._id })).map(views.membershipView);
      out.attendance = (await ctx.store.find('attendance', { studentId: ctx.student._id }, { orderBy: [['classDate', 'desc']] }))
        .map((a) => ({ className: a.className, teacherName: a.teacherName, classDate: a.classDate, status: a.status, checkInAt: a.checkInAt }));
      out.transactions = (await ctx.store.find('transactions', { studentId: ctx.student._id }, { orderBy: [['createdAt', 'desc']] }))
        .map((t) => ({ type: t.type, amount: t.amount, newBalance: t.newBalance, reason: t.reason, createdAt: t.createdAt }));
    }
    return out;
  },

  /**
   * 注销账户：解除微信身份关联并去标识化个人信息。
   * 出勤与课时流水因财务对账需要按法定期限保留，但不再关联可识别个人身份。
   */
  async 'profile.deleteAccount'(ctx, data) {
    if (!ctx.user) throw E.notRegistered();
    if (data.confirm !== true) throw E.invalid('请确认注销');
    if (ctx.roles.includes('owner')) {
      const owners = await countOwners(ctx.store);
      if (owners <= 1) throw E.rule('LAST_OWNER', '唯一店主账户不能注销，请先授权其他店主');
    }
    const ts = time.now();
    if (ctx.student) {
      await ctx.store.transaction((tx) => phoneLib.release(tx, ctx.student.phone, ctx.student._id));
      await ctx.store.update('students', ctx.student._id, {
        userId: '', name: '已注销学员', phone: '', phoneVerified: false, phoneVerifiedAt: null, wxid: '',
        status: 'deleted', deletedAt: ts, updatedAt: ts,
      });
    }
    if (ctx.teacher) await ctx.store.update('teachers', ctx.teacher._id, { status: 'revoked', avatar: '', bio: '', updatedAt: ts });
    await ctx.audit('account.delete', 'user', ctx.user._id, { roles: ctx.roles }, null, '用户主动注销');
    await ctx.store.remove('users', ctx.user._id);
    return { deleted: true };
  },
};
