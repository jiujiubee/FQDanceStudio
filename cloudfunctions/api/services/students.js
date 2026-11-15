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
const { studentAvatarUrls } = require('../lib/avatars');

const WXID = /^[A-Za-z][-_A-Za-z0-9]{5,19}$|^1\d{10}$/;

/** 学员档案 → 关联账户角色（用于列表中的「学员 / 老师 / 店主」身份标识） */
async function rolesByUser(store, students) {
  const uids = [...new Set(students.map((s) => s.userId).filter(Boolean))];
  if (!uids.length) return new Map();
  const users = await store.find('users', { _id: { $in: uids } });
  const tids = users.map((u) => u.teacherId).filter(Boolean);
  const teachers = tids.length ? await store.find('teachers', { _id: { $in: tids } }) : [];
  const active = new Set(teachers.filter((t) => t.status === 'active').map((t) => t._id));
  return new Map(users.map((u) => [u._id, rolesOf(u).filter((r) => r !== 'teacher' || active.has(u.teacherId))]));
}

function readProfile(data, partial) {
  const out = {};
  const opt = (k, fn) => {
    if (data[k] !== undefined) out[k] = fn();
  };
  if (!partial || data.name !== undefined) out.name = v.str(data.name, '姓名', { max: 30 });
  if (!partial || data.phone !== undefined) out.phone = phoneLib.validate(data.phone, { optional: true });
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
    const where = { status: status === 'all' ? { $ne: 'deleted' } : status };
    if (kw) {
      const re = escapeRegex(kw);
      where.$or = [{ name: { $regex: re } }, { wxid: { $regex: re } }, { phone: { $regex: re } }];
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
        if (r) {
          (r.studentIds || []).forEach((id) => allowed.add(id));
          for (const g of r.groups || []) {
            (await ctx.store.find('students', { groups: { $contains: g }, status: 'active' })).forEach((s) => allowed.add(s._id));
          }
        }
      }
      const books = await ctx.store.find('classBookings', { classId: { $in: classes.map((c) => c._id) } });
      books.forEach((b) => allowed.add(b.studentId));
      where._id = { $in: [...allowed] };
    }
    const list = await ctx.store.find('students', where, { orderBy: [['createdAt', 'desc']], skip: page * size, limit: size + 1 });
    const project = ctx.can(P.STUDENT_VIEW_ALL) ? views.studentForStaff : views.studentForTeacher;
    const items = list.slice(0, size);
    const roleMap = await rolesByUser(ctx.store, items);
    const avatarMap = await studentAvatarUrls(ctx, items);
    return { items: items.map((s) => ({ ...project(s), avatar: avatarMap.get(s._id) || '', roles: roleMap.get(s.userId) || ['student'] })), hasMore: list.length > size };
  },

  async 'student.get'(ctx, data) {
    ctx.requireAny(P.STUDENT_VIEW_ALL, P.STUDENT_VIEW_BASIC);
    const id = v.id(data.studentId, '学员');
    await ctx.assertStudentAccess(id);
    const s = await ctx.store.get('students', id);
    if (!s || s.status === 'deleted') throw E.notFound('学员');
    const avatar = (await studentAvatarUrls(ctx, [s])).get(s._id) || '';
    if (!ctx.can(P.STUDENT_VIEW_ALL)) return { student: { ...views.studentForTeacher(s), avatar }, memberships: null };
    const ms = await ctx.store.find('memberships', { studentId: id }, { orderBy: [['createdAt', 'desc']] });
    const month = time.monthKey(time.today());
    const u = s.userId ? await ctx.store.get('users', s.userId) : null;
    const roles = u ? rolesOf(u) : [];
    const t = u && u.teacherId ? await ctx.store.get('teachers', u.teacherId) : null;
    const teaching = roles.includes('teacher') && !!t && t.status === 'active';
    return {
      student: { ...views.studentForStaff(s), avatar, roles: roles.length ? roles.filter((r) => r !== 'teacher' || teaching) : ['student'] },
      account: u ? {
        userId: u._id, roles, teaching, teacherId: teaching ? t._id : '',
        canSetTeacher: ctx.can(P.TEACHER_MANAGE) && u.status === 'active' && !teaching,
        canRevokeTeacher: ctx.can(P.TEACHER_MANAGE) && teaching,
      } : null,
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
      if (profile.phone) await phoneLib.claim(tx, profile.phone, _id);
      await tx.create('students', {
        _id, userId: '', avatar: '',
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
        if (patch.phone) await phoneLib.claim(tx, patch.phone, id);
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
    list.forEach((s) => (Array.isArray(s.groups) ? s.groups : []).forEach((g) => g && set.add(g)));
    return [...set].sort();
  },

  /**
   * 店主在学员详情中「设为老师 / 撤销老师」。仅 OWNER（teacher.manage）可操作。
   * 保留原有学员身份；撤销只停用教师档案，历史课程/签到全部保留。
   */
  async 'student.setTeacher'(ctx, data) {
    ctx.require(P.TEACHER_MANAGE);
    const id = v.id(data.studentId, '学员');
    const enable = data.enable === true;
    const s = await ctx.store.get('students', id);
    if (!s || s.status === 'deleted') throw E.notFound('学员');
    if (!s.userId) throw E.rule('NOT_BOUND', '该学员尚未绑定微信，无法设为老师');
    const staff = require('./staff');
    const fn = enable ? staff['staff.grantRole'] : staff['staff.revokeRole'];
    return fn(ctx, { userId: s.userId, role: 'teacher', reason: v.str(data.reason, '原因', { optional: true, max: 200 }) });
  },
};

module.exports._rolesByUser = rolesByUser;
