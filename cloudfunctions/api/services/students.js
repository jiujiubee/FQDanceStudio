'use strict';
/** 学员管理：搜索、登记、编辑、停用/恢复、分组 */
const time = require('../lib/time');
const ids = require('../lib/ids');
const { E } = require('../lib/errors');
const { v, escapeRegex } = require('../lib/validate');
const views = require('../lib/views');
const { P } = require('../lib/permissions');
const { rolesOf, isStaff } = require('../lib/roles');
const phoneLib = require('../lib/phone');

const WXID = /^[A-Za-z][-_A-Za-z0-9]{5,19}$|^1\d{10}$/;

function readProfile(data, partial) {
  const out = {};
  const opt = (k, fn) => {
    if (data[k] !== undefined) out[k] = fn();
  };
  if (!partial || data.name !== undefined) out.name = v.str(data.name, '姓名', { max: 30 });
  if (!partial || data.phone !== undefined) out.phone = phoneLib.validate(data.phone);
  opt('wxid', () => v.str(data.wxid, '微信号', { optional: true, max: 40, pattern: WXID }));
  opt('gender', () => v.oneOf(data.gender, '性别', ['', 'male', 'female']));
  opt('birthday', () => v.date(data.birthday, '生日', { optional: true }));
  opt('emergencyContact', () => v.str(data.emergencyContact, '紧急联系人', { optional: true, max: 60 }));
  opt('remark', () => v.str(data.remark, '备注', { optional: true, max: 300 }));
  opt('groups', () => {
    if (!Array.isArray(data.groups) || data.groups.length > 10) throw E.invalid('分组格式错误');
    return [...new Set(data.groups.map((g) => v.str(g, '分组', { max: 20 })))];
  });
  return out;
}

module.exports = {
  async 'student.search'(ctx, data) {
    ctx.requireAny(P.STUDENT_VIEW_ALL, P.STUDENT_VIEW_BASIC);
    const kw = v.str(data.keyword, '关键词', { optional: true, max: 40 });
    const status = v.oneOf(data.status, '状态', ['all', 'active', 'suspended'], { optional: true, default: 'all' });
    const page = v.int(data.page, '页码', { optional: true, default: 0, min: 0 });
    const size = 20;
    const where = { status: status === 'all' ? { $in: ['active', 'suspended'] } : status };
    if (kw) {
      const re = escapeRegex(kw);
      where.$or = [{ name: { $regex: re } }, { wxid: { $regex: re } }, { phone: { $regex: re } }, { studentNo: { $regex: re } }];
    }
    if (!ctx.can(P.STUDENT_VIEW_ALL)) {
      // 教师：只能搜索曾在其课程中出现或在其名单中的学员
      if (!ctx.teacher) return { items: [], hasMore: false };
      const att = await ctx.store.find('attendance', { teacherId: ctx.teacher._id });
      const allowed = new Set(att.map((a) => a.studentId));
      const classes = await ctx.store.find('classes', { teacherId: ctx.teacher._id, date: { $gte: time.addDays(time.today(), -90) } });
      const seriesIds = [...new Set(classes.map((c) => c.seriesId))];
      const rosterIds = [...classes.map((c) => `class_${c._id}`), ...seriesIds.map((s) => `series_${s}`)];
      for (const rid of rosterIds) {
        const r = await ctx.store.get('attendanceRosters', rid);
        if (r) (r.studentIds || []).forEach((id) => allowed.add(id));
      }
      where._id = { $in: [...allowed] };
    }
    const list = await ctx.store.find('students', where, { orderBy: [['createdAt', 'desc']], skip: page * size, limit: size + 1 });
    const project = ctx.can(P.STUDENT_VIEW_ALL) ? views.studentForStaff : views.studentForTeacher;
    return { items: list.slice(0, size).map(project), hasMore: list.length > size };
  },

  async 'student.get'(ctx, data) {
    ctx.requireAny(P.STUDENT_VIEW_ALL, P.STUDENT_VIEW_BASIC);
    const id = v.id(data.studentId, '学员');
    await ctx.assertStudentAccess(id);
    const s = await ctx.store.get('students', id);
    if (!s || s.status === 'deleted') throw E.notFound('学员');
    if (!ctx.can(P.STUDENT_VIEW_ALL)) return { student: views.studentForTeacher(s), memberships: null };
    const ms = await ctx.store.find('memberships', { studentId: id }, { orderBy: [['createdAt', 'desc']] });
    const month = time.monthKey(time.today());
    return {
      student: views.studentForStaff(s),
      memberships: ms.map((m) => ({ ...views.membershipView(m), monthUsed: (m.usage && m.usage[month]) || 0 })),
    };
  },

  /** 管理员登记学员（手机号必填，标记为未验证）。学员用同一手机号完成验证注册后自动关联该档案 */
  async 'student.create'(ctx, data) {
    ctx.require(P.STUDENT_MANAGE);
    const profile = readProfile(data, false);
    const ts = time.now();
    const _id = ids.randomId('stu_');
    await ctx.store.transaction(async (tx) => {
      await phoneLib.claim(tx, profile.phone, _id);
      await tx.create('students', {
        _id, userId: '', studentNo: `S${time.today().replace(/-/g, '').slice(2)}${ids.shortCode(4)}`, avatar: '',
        wxid: '', gender: '', birthday: '', emergencyContact: '', remark: '', groups: [],
        ...profile, phoneVerified: false, phoneVerifiedAt: null, phoneVerifyMethod: '', status: 'active',
        membershipSummary: { type: 'none', label: '未开卡', remainingCredits: 0, expireDate: '', status: 'none' },
        createdBy: ctx.user._id, createdAt: ts, updatedAt: ts,
      });
    });
    await ctx.audit('student.create', 'student', _id, null, { name: profile.name }, '');
    return { studentId: _id };
  },

  async 'student.update'(ctx, data) {
    ctx.require(P.STUDENT_MANAGE);
    const id = v.id(data.studentId, '学员');
    const s = await ctx.store.get('students', id);
    if (!s || s.status === 'deleted') throw E.notFound('学员');
    const patch = readProfile(data, true);
    if (!Object.keys(patch).length) return { updated: false };
    if (patch.phone !== undefined && patch.phone !== s.phone) {
      Object.assign(patch, { phoneVerified: false, phoneVerifiedAt: null, phoneVerifyMethod: '' });
      await ctx.store.transaction(async (tx) => {
        await phoneLib.claim(tx, patch.phone, id);
        await phoneLib.release(tx, s.phone, id);
        await tx.update('students', id, { ...patch, updatedAt: time.now() });
      });
    } else {
      if (patch.phone !== undefined) delete patch.phone;
      await ctx.store.update('students', id, { ...patch, updatedAt: time.now() });
    }
    if (patch.name && s.userId) await ctx.store.update('users', s.userId, { name: patch.name, updatedAt: time.now() }).catch(() => null);
    const before = {};
    Object.keys(patch).forEach((k) => { before[k] = s[k]; });
    await ctx.audit('student.update', 'student', id, before, patch, '');
    return { updated: true };
  },

  async 'student.setStatus'(ctx, data) {
    ctx.require(P.STUDENT_SUSPEND);
    const id = v.id(data.studentId, '学员');
    const status = v.oneOf(data.status, '状态', ['active', 'suspended']);
    const reason = v.str(data.reason, '原因', { max: 200 });
    const s = await ctx.store.get('students', id);
    if (!s || s.status === 'deleted') throw E.notFound('学员');
    const ts = time.now();
    await ctx.store.update('students', id, { status, updatedAt: ts });
    if (s.userId) {
      const u = await ctx.store.get('users', s.userId);
      if (u && !isStaff(rolesOf(u))) await ctx.store.update('users', s.userId, { status, updatedAt: ts });
    }
    await ctx.audit('student.status', 'student', id, { status: s.status }, { status }, reason);
    return { status };
  },

  async 'student.groups'(ctx) {
    ctx.requireAny(P.STUDENT_MANAGE, P.ROSTER_MANAGE);
    const list = await ctx.store.find('students', { status: 'active' });
    const set = new Set();
    list.forEach((s) => (s.groups || []).forEach((g) => set.add(g)));
    return [...set].sort();
  },
};
