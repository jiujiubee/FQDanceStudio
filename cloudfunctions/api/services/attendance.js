'use strict';
/** 教师/管理端：今日看板、课程签到详情、手动签到与更正 */
const time = require('../lib/time');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const views = require('../lib/views');
const { P } = require('../lib/permissions');
const core = require('../lib/attendance-core');
const { resolveRoster } = require('../lib/roster');

function scopeWhere(ctx, where) {
  if (ctx.can(P.ATTENDANCE_VIEW_ALL) || ctx.can(P.CLASS_VIEW_ALL)) return where;
  if (ctx.teacher) return { ...where, teacherId: ctx.teacher._id };
  throw E.forbidden();
}

async function classStats(ctx, cls) {
  const att = await ctx.store.find('attendance', { classId: cls._id });
  const present = att.filter((a) => a.status === 'present');
  const roster = await resolveRoster(ctx.store, cls);
  let expected = null;
  let notCheckedIn = null;
  if (roster) {
    const presentIds = new Set(present.map((a) => a.studentId));
    expected = roster.studentIds.length;
    notCheckedIn = roster.studentIds.filter((id) => !presentIds.has(id)).length;
  }
  return { checkedIn: present.length, expected, notCheckedIn, hasRoster: !!roster };
}

module.exports = {
  async 'teacher.dashboard'(ctx, data) {
    ctx.requireAny(P.ATTENDANCE_VIEW_ASSIGNED, P.ATTENDANCE_VIEW_ALL);
    const date = data.date ? v.date(data.date, '日期') : time.today();
    const mine = data.scope === 'mine' || !(ctx.can(P.ATTENDANCE_VIEW_ALL) || ctx.can(P.CLASS_VIEW_ALL));
    let where = { date };
    if (mine) {
      if (!ctx.teacher) return { date, classes: [], totals: { classes: 0, checkedIn: 0, expected: 0, notCheckedIn: 0 } };
      where.teacherId = ctx.teacher._id;
    } else where = scopeWhere(ctx, where);
    const classes = await ctx.store.find('classes', where, { orderBy: [['startTime', 'asc']] });
    const items = [];
    const totals = { classes: 0, checkedIn: 0, expected: 0, notCheckedIn: 0 };
    for (const c of classes) {
      const s = await classStats(ctx, c);
      items.push({ ...views.classView(c), ...s });
      if (c.status !== 'cancelled') {
        totals.classes += 1;
        totals.checkedIn += s.checkedIn;
        if (s.hasRoster) {
          totals.expected += s.expected;
          totals.notCheckedIn += s.notCheckedIn;
        }
      }
    }
    return { date, classes: items, totals, serverNow: time.now() };
  },

  async 'attendance.classDetail'(ctx, data) {
    ctx.requireAny(P.ATTENDANCE_VIEW_ASSIGNED, P.ATTENDANCE_VIEW_ALL);
    const cls = await ctx.store.get('classes', v.id(data.classId, '课程'));
    if (!cls) throw E.notFound('课程');
    ctx.assertClassAccess(cls);
    const att = await ctx.store.find('attendance', { classId: cls._id }, { orderBy: [['checkInAt', 'asc']] });
    const roster = await resolveRoster(ctx.store, cls);
    const presentIds = new Set(att.filter((a) => a.status === 'present').map((a) => a.studentId));
    const studentIds = [...new Set([...att.map((a) => a.studentId), ...(roster ? roster.studentIds : [])])];
    const students = studentIds.length ? await ctx.store.find('students', { _id: { $in: studentIds } }) : [];
    const sMap = new Map(students.map((s) => [s._id, s]));
    const row = (sid, a) => {
      const s = sMap.get(sid);
      return {
        studentId: sid,
        name: s ? s.name : (a && a.studentName) || '学员',
        avatar: s ? s.avatar || '' : '',
        status: a ? a.status : 'pending',
        source: a ? a.source : '',
        checkInAt: a ? a.checkInAt : null,
        history: a && ctx.can(P.ATTENDANCE_MARK) ? (a.history || []).map((h) => ({ at: h.at, from: h.from, to: h.to, reason: h.reason })) : [],
      };
    };
    const checkedIn = att.filter((a) => a.status === 'present').map((a) => row(a.studentId, a));
    const attMap = new Map(att.map((a) => [a.studentId, a]));
    let notCheckedIn = null;
    if (roster) notCheckedIn = roster.studentIds.filter((id) => !presentIds.has(id)).map((id) => row(id, attMap.get(id)));
    // 无名单时，仅列出被标记为缺勤/取消的记录，不会把全部学员视为缺勤
    const others = att.filter((a) => a.status !== 'present' && !(roster && roster.studentIds.includes(a.studentId))).map((a) => row(a.studentId, a));
    return {
      class: views.classView(cls),
      hasRoster: !!roster,
      checkedIn,
      notCheckedIn,
      others,
      stats: { checkedIn: checkedIn.length, expected: roster ? roster.studentIds.length : null, notCheckedIn: notCheckedIn ? notCheckedIn.length : null },
      canMark: ctx.can(P.ATTENDANCE_MARK),
    };
  },

  /** 手动签到/更正。status: present | absent；reason 必填；全程审计 */
  async 'attendance.mark'(ctx, data) {
    ctx.require(P.ATTENDANCE_MARK);
    const classId = v.id(data.classId, '课程');
    const studentId = v.id(data.studentId, '学员');
    const status = v.oneOf(data.status, '状态', ['present', 'absent']);
    const reason = v.str(data.reason, '原因', { max: 200 });
    const cls = await ctx.store.get('classes', classId);
    if (!cls) throw E.notFound('课程');
    ctx.assertClassAccess(cls);
    if (status === 'present' && cls.startAt - time.now() > 24 * 3600 * 1000) throw E.rule('TOO_EARLY', '不能为尚未开始的课程代签');
    const before = await ctx.store.get('attendance', `${classId}_${studentId}`);
    const r = status === 'present'
      ? await core.markPresent(ctx.store, { classId, studentId, operatorId: ctx.user._id, source: 'manual', reason, enforceWindow: false, settings: ctx.settings })
      : await core.markAbsent(ctx.store, { classId, studentId, operatorId: ctx.user._id, reason });
    await ctx.audit('attendance.mark', 'attendance', r.attendanceId, { status: before ? before.status : 'none' }, { status }, reason);
    return { attendanceId: r.attendanceId, status };
  },

  /** 管理端：查看任意学员的出勤记录；教师仅能查看与其课程相关的学员 */
  async 'attendance.studentHistory'(ctx, data) {
    ctx.requireAny(P.ATTENDANCE_VIEW_ALL, P.ATTENDANCE_VIEW_ASSIGNED);
    const studentId = v.id(data.studentId, '学员');
    await ctx.assertStudentAccess(studentId);
    const where = scopeWhere(ctx, { studentId });
    const page = v.int(data.page, '页码', { optional: true, default: 0, min: 0 });
    const list = await ctx.store.find('attendance', where, { orderBy: [['classDate', 'desc'], ['startTime', 'desc']], skip: page * 30, limit: 31 });
    return {
      items: list.slice(0, 30).map((a) => ({
        _id: a._id, className: a.className, teacherName: a.teacherName, classDate: a.classDate, startTime: a.startTime,
        checkInAt: a.checkInAt, status: a.status, source: a.source,
      })),
      hasMore: list.length > 30,
    };
  },
};
