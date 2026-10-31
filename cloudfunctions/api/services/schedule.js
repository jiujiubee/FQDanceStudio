'use strict';
/** 学员端：周课表、签到、会员信息 */
const time = require('../lib/time');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const views = require('../lib/views');
const { P } = require('../lib/permissions');
const rules = require('../lib/membership-rules');
const core = require('../lib/attendance-core');

const MAX_FUTURE_WEEKS = 26;

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
    const active = classes.filter((c) => c.endAt > nowMs);

    let attMap = new Map();
    let memberships = [];
    const student = ctx.student && ctx.student.status === 'active' ? ctx.student : null;
    if (student && active.length) {
      const att = await ctx.store.find('attendance', { studentId: student._id, classDate: { $gte: start, $lte: end } });
      attMap = new Map(att.map((a) => [a.classId, a]));
      memberships = await ctx.store.find('memberships', { studentId: student._id, status: { $in: ['active', 'expired', 'suspended'] } });
    }

    const items = active.map((c) => {
      const base = views.classView(c);
      const a = attMap.get(c._id);
      const w = core.checkInWindow(c, ctx.settings);
      let state = 'upcoming';
      let canCheckIn = false;
      let hint = '';
      if (c.status === 'cancelled') {
        state = 'cancelled';
        hint = '已取消';
      } else if (a && a.status === 'present') {
        state = 'checked_in';
        hint = '已签到';
      } else if (!student) {
        hint = '';
      } else {
        const { membership, reason } = rules.pickMembership(memberships, c.date);
        if (!membership) {
          state = ['INSUFFICIENT_CREDITS', 'MONTHLY_LIMIT_REACHED', 'QUOTA_EXHAUSTED'].includes(reason) ? 'insufficient' : 'ineligible';
          hint = reason === 'INSUFFICIENT_CREDITS' ? '课时不足' : rules.REASON_TEXT[reason];
        } else if (nowMs < w.open) {
          hint = `开课前${ctx.settings.checkin.openBeforeMinutes}分钟可签到`;
        } else if (nowMs > w.close) {
          hint = '签到已截止';
        } else {
          canCheckIn = true;
          hint = '可签到';
        }
      }
      return { ...base, state, canCheckIn, hint, checkInAt: a && a.status === 'present' ? a.checkInAt : null, checkInOpenAt: w.open };
    });

    // 课程标记点：用于周历显示有课的日期
    const marks = {};
    for (const c of active) if (c.status !== 'cancelled') marks[c.date] = (marks[c.date] || 0) + 1;
    return { weekStart: start, weekEnd: end, today, serverNow: nowMs, classes: items, marks };
  },

  async 'attendance.checkIn'(ctx, data) {
    ctx.require(P.SELF_CHECKIN);
    const student = ctx.requireStudent();
    const classId = v.id(data.classId, '课程');
    const r = await core.markPresent(ctx.store, {
      classId, studentId: student._id, operatorId: ctx.user._id, source: 'self', enforceWindow: true, settings: ctx.settings,
    });
    return { classId, checkInAt: r.checkInAt };
  },

  async 'attendance.myHistory'(ctx, data) {
    ctx.require(P.SELF_ATTENDANCE);
    const student = ctx.requireStudent();
    const today = time.today();
    const range = v.oneOf(data.range, '筛选', ['all', 'week', 'month', 'custom'], { optional: true, default: 'all' });
    const where = { studentId: student._id };
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
    const list = await ctx.store.find('attendance', where, {
      orderBy: [['classDate', 'desc'], ['startTime', 'desc']], skip: page * size, limit: size + 1,
    });
    return {
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
