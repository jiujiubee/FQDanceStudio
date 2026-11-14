'use strict';
/** 学员端：周课表、签到、会员信息 */
const time = require('../lib/time');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const views = require('../lib/views');
const { P } = require('../lib/permissions');
const rules = require('../lib/membership-rules');
const core = require('../lib/attendance-core');
const bk = require('../lib/booking-core');
const { bookingCancellationCutoffMinutes } = require('../lib/settings-defaults');
const { videoUrl } = require('../lib/class-video');

const MAX_FUTURE_WEEKS = 26;
const AVATAR_LIMIT = 5;
const ACTIVE_CANCELABLE = ['booked', 'checked_in'];

/** 课程进行阶段：cancelled / upcoming（未开始）/ ongoing（上课中）/ ended（已结束） */
function phaseOf(c, nowMs) {
  if (c.status === 'cancelled') return 'cancelled';
  if (nowMs >= c.endAt) return 'ended';
  if (nowMs >= c.startAt) return 'ongoing';
  return 'upcoming';
}

/**
 * 为学员端组装课程卡片数据：当前学员的预约/签到状态、老师头像、真实预约人数与已预约学员头像。
 * 预约人数以 classBookings 中有效记录（已预约/已签到/已完成）为准。
 */
async function decorateClasses(ctx, list, range) {
  const nowMs = time.now();
  if (!list.length) return [];
  const cutoffMinutes = bookingCancellationCutoffMinutes(ctx.settings);
  const cancelOpen = (c) => nowMs < c.startAt - cutoffMinutes * 60000;
  const classIds = list.map((c) => c._id);
  const avatarLimit = range.avatarLimit || AVATAR_LIMIT;

  let attMap = new Map();
  let bookMap = new Map();
  let memberships = [];
  const student = ctx.student && ctx.student.status === 'active' ? ctx.student : null;
  if (student) {
    const att = await ctx.store.find('attendance', { studentId: student._id, classDate: { $gte: range.from, $lte: range.to } });
    attMap = new Map(att.map((a) => [a.classId, a]));
    const books = await ctx.store.find('classBookings', { studentId: student._id, classDate: { $gte: range.from, $lte: range.to } });
    bookMap = new Map(books.map((b) => [b.classId, b]));
    memberships = await ctx.store.find('memberships', { studentId: student._id, status: { $in: ['active', 'expired', 'suspended'] } });
  }

  const allBooks = await ctx.store.find('classBookings', { classId: { $in: classIds }, status: { $in: bk.ACTIVE } }, { orderBy: [['bookedAt', 'asc']] });
  const byClass = new Map();
  for (const b of allBooks) {
    if (!byClass.has(b.classId)) byClass.set(b.classId, []);
    byClass.get(b.classId).push(b);
  }
  const shownStudentIds = new Set();
  for (const arr of byClass.values()) arr.slice(0, avatarLimit).forEach((b) => shownStudentIds.add(b.studentId));
  const studs = shownStudentIds.size ? await ctx.store.find('students', { _id: { $in: [...shownStudentIds] } }) : [];
  const sMap = new Map(studs.map((s) => [s._id, s]));
  const teacherIds = [...new Set(list.map((c) => c.teacherId).filter(Boolean))];
  const teachers = teacherIds.length ? await ctx.store.find('teachers', { _id: { $in: teacherIds } }) : [];
  const tMap = new Map(teachers.map((t) => [t._id, t]));

  return list.map((c) => {
    const base = views.classView(c);
    const a = attMap.get(c._id);
    const b = bookMap.get(c._id);
    const booked = !!b && b.status === 'booked';
    const classBooks = byClass.get(c._id) || [];
    const bookedCount = classBooks.length;
    const remaining = c.capacity ? Math.max(0, c.capacity - bookedCount) : null;
    const phase = phaseOf(c, nowMs);
    let state = 'upcoming';
    // 学员不可自主签到：预约即签到，签到仅由教师代签
    const canCheckIn = false;
    let canBook = false;
    let canCancelBooking = false;
    let hint = '';
    if (c.status === 'cancelled') {
      state = 'cancelled';
      hint = '已取消';
    } else if (a && a.status === 'present') {
      state = 'checked_in';
      hint = '已签到';
      canCancelBooking = !!b && ACTIVE_CANCELABLE.includes(b.status) && cancelOpen(c);
    } else if (!student) {
      hint = phase === 'ended' ? '已结束' : '';
    } else {
      const { membership, reason } = rules.pickMembership(memberships, c.date);
      if (booked) {
        state = 'booked';
        canCancelBooking = cancelOpen(c);
        if (!membership) state = ['INSUFFICIENT_CREDITS', 'MONTHLY_LIMIT_REACHED', 'QUOTA_EXHAUSTED'].includes(reason) ? 'insufficient' : 'ineligible';
        if (!membership) hint = reason === 'INSUFFICIENT_CREDITS' ? '课时不足' : rules.REASON_TEXT[reason];
        else if (phase === 'ended') { state = 'ended'; hint = '已结束'; }
        else hint = '已预约';
      } else if (phase === 'ended') {
        state = 'ended';
        hint = '已结束';
      } else if (!membership) {
        state = ['INSUFFICIENT_CREDITS', 'MONTHLY_LIMIT_REACHED', 'QUOTA_EXHAUSTED'].includes(reason) ? 'insufficient' : 'ineligible';
        hint = reason === 'INSUFFICIENT_CREDITS' ? '课时不足' : rules.REASON_TEXT[reason];
      } else if (nowMs >= c.startAt) {
        state = 'started';
        hint = '课程已开始';
      } else if (remaining === 0) {
        state = 'full';
        hint = '名额已满';
      } else {
        canBook = true;
        hint = '可预约';
      }
    }
    const t = tMap.get(c.teacherId);
    return {
      ...base, state, phase, canCheckIn, canBook, canCancelBooking, hint, remaining, bookedCount,
      bookingCancellationCutoffMinutes: cutoffMinutes,
      teacherAvatar: (t && t.avatar) || '',
      bookedStudents: classBooks.slice(0, avatarLimit).map((x) => {
        const s = sMap.get(x.studentId);
        const name = (s && s.name) || x.studentName || '';
        return { id: x.studentId, avatar: (s && s.avatar) || '', initial: name ? name.substring(0, 1) : '?' };
      }),
      bookingStatus: bk.displayStatus(b, c),
      checkInAt: a && a.status === 'present' ? a.checkInAt : null,
    };
  });
}

module.exports = {
  /**
   * 获取一周课程（含每节课对当前学员的状态）。
   * 不允许查看本周之前的周；已结束课程从活动课表中移除（历史保留在签到记录中）。
   */
  async 'schedule.week'(ctx, data) {
    ctx.require(P.SELF_SCHEDULE);
    const today = time.today();
    const thisWeek = time.weekStart(today);
    const start = data.weekStart ? v.date(data.weekStart, '周起始日') : thisWeek;
    if (time.weekStart(start) !== start) throw E.invalid('周起始日必须为周一');
    if (start < thisWeek) throw E.rule('PAST_WEEK', '不能查看以往周的课程');
    if (time.diffDays(thisWeek, start) > MAX_FUTURE_WEEKS * 7) throw E.invalid('超出可查看范围');
    const end = time.addDays(start, 6);
    const nowMs = time.now();

    const classes = await ctx.store.find('classes', { date: { $gte: start, $lte: end } }, { orderBy: [['date', 'asc'], ['startTime', 'asc']] });
    // 当天已结束的课程仍显示（状态「已结束」，不可预约）；更早日期的已结束课程从活动课表中移除
    const active = classes.filter((c) => c.endAt > nowMs || c.date === today);
    const items = await decorateClasses(ctx, active, { from: start, to: end });

    // 课程标记点：用于周历显示有课的日期
    const marks = {};
    for (const c of active) if (c.status !== 'cancelled') marks[c.date] = (marks[c.date] || 0) + 1;
    return { weekStart: start, weekEnd: end, today, serverNow: nowMs, classes: items, marks };
  },

  /** 学员端课程详情：与周课表同一套状态与预约数据 */
  async 'schedule.classDetail'(ctx, data) {
    ctx.require(P.SELF_SCHEDULE);
    const cls = await ctx.store.get('classes', v.id(data.classId, '课程'));
    if (!cls) throw E.notFound('课程');
    const [item] = await decorateClasses(ctx, [cls], { from: cls.date, to: cls.date, avatarLimit: 30 });
    item.videoUrl = cls.status === 'cancelled' ? '' : await videoUrl(ctx, cls.videoFileId);
    return { class: item, serverNow: time.now() };
  },

  /** 学员预约课程：预约即签到，同一事务内占名额、扣课时、写流水与出勤记录 */
  async 'booking.create'(ctx, data) {
    ctx.require(P.SELF_SCHEDULE);
    const student = ctx.requireStudent();
    if (student.status !== 'active') throw E.rule('STUDENT_INACTIVE', '学员状态不可预约');
    const classId = v.id(data.classId, '课程');
    const cur = await ctx.store.get('classBookings', bk.bookingId(classId, student._id));
    if (cur && bk.ACTIVE.includes(cur.status)) throw E.conflict('ALREADY_BOOKED', '已预约该课程，请勿重复预约');
    let r;
    try {
      r = await core.markPresent(ctx.store, {
        classId, studentId: student._id, operatorId: ctx.user._id, source: 'self', reason: '预约即签到',
        enforceWindow: false, requireNotStarted: true, settings: ctx.settings,
      });
    } catch (e) {
      if (e && e.code === 'ALREADY_CHECKED_IN') throw E.conflict('ALREADY_BOOKED', '已预约该课程，请勿重复预约');
      throw e;
    }
    const summary = await rules.refreshSummary(ctx.store, student._id);
    const [item] = await decorateClasses(ctx, [await ctx.store.get('classes', classId)], { from: '0000-00-00', to: '9999-99-99', avatarLimit: 30 });
    return { classId, bookingId: bk.bookingId(classId, student._id), status: 'checked_in', checkInAt: r.checkInAt, deduction: r.deduction, summary, class: item };
  },

  async 'booking.cancel'(ctx, data) {
    ctx.require(P.SELF_SCHEDULE);
    const student = ctx.requireStudent();
    const classId = v.id(data.classId, '课程');
    const r = await core.cancelBookingWithRefund(ctx.store, {
      classId, studentId: student._id, operatorId: ctx.user._id,
      bookingCancellationCutoffMinutes: bookingCancellationCutoffMinutes(ctx.settings), reason: '学员取消',
    });
    const summary = await rules.refreshSummary(ctx.store, student._id);
    const [item] = await decorateClasses(ctx, [await ctx.store.get('classes', classId)], { from: '0000-00-00', to: '9999-99-99', avatarLimit: 30 });
    return { ...r, status: 'cancelled', summary, class: item };
  },

  /** 我的预约：upcoming / history */
  async 'booking.mine'(ctx, data) {
    ctx.require(P.SELF_SCHEDULE);
    const student = ctx.requireStudent();
    const scope = v.oneOf(data.scope, '范围', ['upcoming', 'history'], { optional: true, default: 'upcoming' });
    const page = v.int(data.page, '页码', { optional: true, default: 0, min: 0 });
    const size = 20;
    const today = time.today();
    const where = { studentId: student._id, classDate: scope === 'upcoming' ? { $gte: today } : { $lte: today } };
    const list = await ctx.store.find('classBookings', where, {
      orderBy: [['classDate', scope === 'upcoming' ? 'asc' : 'desc'], ['startTime', scope === 'upcoming' ? 'asc' : 'desc']],
      skip: page * size, limit: size + 1,
    });
    const nowMs = time.now();
    const items = list.slice(0, size).map((b) => ({
      _id: b._id, classId: b.classId, className: b.className, teacherName: b.teacherName, classDate: b.classDate,
      startTime: b.startTime, endTime: b.endTime, bookedAt: b.bookedAt, checkedInAt: b.checkedInAt,
      status: b.status === 'checked_in' && b.classStartAt && nowMs > b.classStartAt ? 'completed' : b.status,
      cancelReason: b.cancelReason || '',
    }));
    return { items, hasMore: list.length > size };
  },

  async 'attendance.myHistory'(ctx, data) {
    ctx.require(P.SELF_ATTENDANCE);
    const student = ctx.requireStudent();
    const today = time.today();
    const range = v.oneOf(data.range, '筛选', ['all', 'week', 'month', 'custom'], { optional: true, default: 'all' });
    // 上课记录：仅统计扣课成功（present）且已开课的课程；未开课的预约仍可取消，不计入已完成
    const where = { studentId: student._id, status: 'present' };
    if (range === 'week') where.classDate = { $gte: time.weekStart(today), $lte: time.addDays(time.weekStart(today), 6) };
    else if (range === 'month') where.classDate = { $gte: `${time.monthKey(today)}-01`, $lte: `${time.monthKey(today)}-31` };
    else if (range === 'custom') {
      const from = v.date(data.from, '开始日期');
      const to = v.date(data.to, '结束日期');
      if (from > to) throw E.invalid('开始日期不能晚于结束日期');
      where.classDate = { $gte: from, $lte: to };
    }
    const page = v.int(data.page, '页码', { optional: true, default: 0, min: 0 });
    const size = 20;
    const nowMs = time.now();
    // 老师代签已实际扣课且学员不可取消，直接计入；学员预约需开课后才计入
    const isDone = (a) => a.source !== 'self' || time.toMs(a.classDate, a.startTime) <= nowMs;
    const all = (await ctx.store.find('attendance', where, { orderBy: [['classDate', 'desc'], ['startTime', 'desc']] })).filter(isDone);
    const totalAll = (await ctx.store.find('attendance', { studentId: student._id, status: 'present' })).filter(isDone).length;
    const list = all.slice(page * size, page * size + size + 1);
    return {
      total: all.length,
      completedTotal: totalAll,
      items: list.slice(0, size).map((a) => ({
        _id: a._id, className: a.className, teacherName: a.teacherName, classDate: a.classDate,
        startTime: a.startTime, endTime: a.endTime, checkInAt: a.checkInAt, status: a.status, source: a.source,
      })),
      hasMore: list.length > size,
    };
  },

  async 'membership.mine'(ctx) {
    ctx.require(P.SELF_MEMBERSHIP);
    const student = ctx.requireStudent();
    const list = await ctx.store.find('memberships', { studentId: student._id }, { orderBy: [['expireDate', 'desc']] });
    const month = time.monthKey(time.today());
    const summary = await rules.refreshSummary(ctx.store, student._id);
    return {
      summary,
      memberships: list.map((m) => ({ ...views.membershipView(m), monthUsed: (m.usage && m.usage[month]) || 0 })),
    };
  },
};
