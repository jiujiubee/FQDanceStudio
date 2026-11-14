'use strict';
/** 课程管理：单次 / 每周重复 / 多日期排课，编辑、取消单节或整个批次，上课名单 */
const time = require('../lib/time');
const ids = require('../lib/ids');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const views = require('../lib/views');
const { P } = require('../lib/permissions');
const core = require('../lib/attendance-core');
const { resolveRoster } = require('../lib/roster');
const { videoUrl } = require('../lib/class-video');

const MAX_SESSIONS = 200;
const VIDEO_RE = /^cloud:\/\/[^/]+\/class-videos\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(mp4|mov|m4v)$/i;

/** 课程视频：空串表示无视频；只接受操作者本人上传目录或该课程原有的视频 */
function videoFileId(ctx, val, current) {
  if (val === null || val === '') return '';
  const s = v.str(val, '课程视频', { max: 300 });
  if (s === current) return s;
  if (!VIDEO_RE.test(s) || !s.includes(`/class-videos/${ctx.user._id}/`)) throw E.invalid('课程视频文件无效');
  return s;
}

/** 仅当没有任何课程仍引用该视频时才删除云存储文件 */
async function releaseVideo(ctx, fileId) {
  if (!fileId) return false;
  const inUse = await ctx.store.count('classes', { videoFileId: fileId });
  if (inUse) return false;
  if (!ctx.providers.deleteFiles) return false;
  try {
    await ctx.providers.deleteFiles([fileId]);
    return true;
  } catch (e) {
    console.error('[class.video] delete failed', fileId, e && e.message);
    return false;
  }
}

/** 纯函数：根据排课模式生成日期列表（已去重、排序） */
function generateDates(mode, data) {
  if (mode === 'single') return [v.date(data.date, '上课日期')];
  if (mode === 'multi') {
    if (!Array.isArray(data.dates) || !data.dates.length) throw E.invalid('请至少选择一个日期');
    return [...new Set(data.dates.map((d) => v.date(d, '上课日期')))].sort();
  }
  if (mode === 'weekly') {
    const start = v.date(data.startDate, '开始日期');
    const end = v.date(data.endDate, '结束日期');
    if (end < start) throw E.invalid('结束日期不能早于开始日期');
    if (time.diffDays(start, end) > 366) throw E.invalid('重复排课范围不能超过一年');
    if (!Array.isArray(data.weekdays) || !data.weekdays.length) throw E.invalid('请选择上课星期');
    const wds = new Set(data.weekdays.map((w) => v.int(w, '星期', { min: 1, max: 7 })));
    const out = [];
    for (let d = start; d <= end; d = time.addDays(d, 1)) if (wds.has(time.weekday(d))) out.push(d);
    if (!out.length) throw E.invalid('所选范围内没有符合条件的日期');
    return out;
  }
  throw E.invalid('排课模式错误');
}

function computeTimes(date, startTime, duration) {
  const end = time.addMinutes(startTime, duration);
  if (end.overflow) throw E.invalid('课程不能跨天');
  return { endTime: end.time, startAt: time.toMs(date, startTime), endAt: time.toMs(date, startTime) + duration * 60000 };
}

async function getActiveTeacher(store, teacherId) {
  const t = await store.get('teachers', v.id(teacherId, '教师'));
  if (!t || t.status !== 'active') throw E.invalid('教师不存在或已停用');
  return t;
}

async function cancelOne(ctx, cls, reason, refund) {
  if (cls.status === 'cancelled') return { affected: 0, refunded: 0, skipped: true };
  const ts = time.now();
  await ctx.store.update('classes', cls._id, { status: 'cancelled', cancelReason: reason, cancelledAt: ts, cancelledBy: ctx.user._id, updatedAt: ts });
  const r = await core.cancelClassAttendance(ctx.store, cls, ctx.user._id, refund, reason);
  await ctx.audit('class.cancel', 'class', cls._id, { status: cls.status }, { status: 'cancelled', refund, ...r }, reason);
  return r;
}

module.exports = {
  /** 创建排课。requestId 由客户端生成，保证重复提交幂等；同一教师同一时段的重复课程会被跳过 */
  async 'class.create'(ctx, data) {
    ctx.require(P.CLASS_MANAGE);
    const mode = v.oneOf(data.mode, '排课模式', ['single', 'weekly', 'multi']);
    const name = v.str(data.name, '课程名称', { max: 40 });
    const teacher = await getActiveTeacher(ctx.store, data.teacherId);
    const startTime = v.time(data.startTime, '开始时间');
    const duration = v.int(data.duration, '课程时长', { min: 15, max: 480 });
    const capacity = v.int(data.capacity, '人数上限', { optional: true, default: null, min: 1, max: 999 });
    const description = v.str(data.description, '课程简介', { optional: true, max: 500 });
    const room = v.str(data.room, '教室', { optional: true, max: 20 });
    const level = v.int(data.level, '难度', { optional: true, default: 0, min: 0, max: 5 });
    const video = data.videoFileId !== undefined ? videoFileId(ctx, data.videoFileId, '') : '';
    const requestId = v.str(data.requestId, '请求编号', { max: 64, pattern: /^[A-Za-z0-9_-]{8,64}$/ });
    const dates = generateDates(mode, data);
    if (dates.length > MAX_SESSIONS) throw E.invalid(`单次最多生成${MAX_SESSIONS}节课`);
    const today = time.today();
    if (dates.some((d) => d < today)) throw E.invalid('不能为过去的日期排课');

    const seriesId = ids.seriesId(requestId);
    const existingSeries = await ctx.store.get('classSeries', seriesId);
    if (existingSeries) {
      // 同一请求重复提交：仅当课程确实已写入数据库时才返回成功
      const saved = await ctx.store.find('classes', { seriesId });
      if (!saved.length) throw E.conflict('DUPLICATE_REQUEST', '请求编号已被使用，请重新提交');
      return { seriesId, created: saved.length, classIds: saved.map((c) => c._id), skipped: [], idempotent: true };
    }

    const ts = time.now();
    // 重复课程检测：同教师、同日期、同开始时间、未取消
    const existing = await ctx.store.find('classes', {
      teacherId: teacher._id, date: { $in: dates }, startTime, status: 'scheduled',
    });
    const dup = new Set(existing.map((c) => c.date));
    const classIds = [];
    const skipped = [];
    for (const date of dates) {
      if (dup.has(date)) {
        skipped.push(date);
        continue;
      }
      const t = computeTimes(date, startTime, duration);
      const id = ids.classId(seriesId, date);
      try {
        await ctx.store.create('classes', {
          _id: id, seriesId, name, teacherId: teacher._id, teacherName: teacher.name,
          date, startTime, endTime: t.endTime, duration, startAt: t.startAt, endAt: t.endAt,
          capacity, description, room, level, videoFileId: video, status: 'scheduled',
        });
        classIds.push(id);
      } catch (e) {
        if (e.code !== 'DUPLICATE') throw e;
        skipped.push(date);
      }
    }
    if (!classIds.length) throw E.conflict('DUPLICATE_CLASS', '所选时间已存在相同课程');
    // 写入确认：重新读取，确保课程已真实保存
    const saved = await ctx.store.find('classes', { seriesId });
    if (saved.length !== classIds.length) throw E.conflict('WRITE_FAILED', `课程保存失败（应保存${classIds.length}节，实际${saved.length}节），请重试`);
    await ctx.store.create('classSeries', {
      _id: seriesId, mode, name, teacherId: teacher._id, startTime, duration,
      weekdays: mode === 'weekly' ? data.weekdays.map(Number) : [], startDate: dates[0], endDate: dates[dates.length - 1],
      dates, classIds, status: 'active', createdBy: ctx.user._id, createdAt: ts,
    });
    if (Array.isArray(data.rosterStudentIds) || Array.isArray(data.rosterGroups)) {
      const studentIds = v.ids(data.rosterStudentIds || [], '名单学员');
      const groups = (data.rosterGroups || []).map((g) => v.str(g, '分组', { max: 20 }));
      if (studentIds.length || groups.length) {
        await ctx.store.set('attendanceRosters', `series_${seriesId}`, { seriesId, studentIds, groups, updatedBy: ctx.user._id, updatedAt: ts });
      }
    }
    await ctx.audit('class.create', 'classSeries', seriesId, null, { mode, name, count: classIds.length }, '');
    return { seriesId, created: classIds.length, classIds, skipped };
  },

  /** 按日期范围列出课程（管理端日历/列表），教师仅看自己的 */
  async 'class.list'(ctx, data) {
    ctx.requireAny(P.CLASS_VIEW_ALL, P.CLASS_VIEW_ASSIGNED);
    const from = v.date(data.from, '开始日期');
    const to = v.date(data.to, '结束日期');
    if (time.diffDays(from, to) > 62 || to < from) throw E.invalid('日期范围错误');
    const where = { date: { $gte: from, $lte: to } };
    if (!ctx.can(P.CLASS_VIEW_ALL)) {
      if (!ctx.teacher) return { classes: [], marks: {} };
      where.teacherId = ctx.teacher._id;
    } else if (data.teacherId) where.teacherId = v.id(data.teacherId, '教师');
    const list = await ctx.store.find('classes', where, { orderBy: [['date', 'asc'], ['startTime', 'asc']] });
    const marks = {};
    for (const c of list) if (c.status !== 'cancelled') marks[c.date] = (marks[c.date] || 0) + 1;
    return { classes: list.map(views.classView), marks };
  },

  async 'class.get'(ctx, data) {
    ctx.requireAny(P.CLASS_VIEW_ALL, P.CLASS_VIEW_ASSIGNED);
    const cls = await ctx.store.get('classes', v.id(data.classId, '课程'));
    if (!cls) throw E.notFound('课程');
    ctx.assertClassAccess(cls);
    const series = cls.seriesId ? await ctx.store.get('classSeries', cls.seriesId) : null;
    const roster = await resolveRoster(ctx.store, cls);
    const own = await ctx.store.get('attendanceRosters', `class_${cls._id}`);
    const seriesRoster = cls.seriesId ? await ctx.store.get('attendanceRosters', `series_${cls.seriesId}`) : null;
    return {
      class: { ...views.classView(cls), videoUrl: await videoUrl(ctx, cls.videoFileId) },
      series: series ? { _id: series._id, mode: series.mode, count: series.classIds.length, status: series.status, startDate: series.startDate, endDate: series.endDate, weekdays: series.weekdays } : null,
      roster: roster ? { studentIds: roster.studentIds, count: roster.studentIds.length } : null,
      rosterSource: own ? 'class' : seriesRoster ? 'series' : 'none',
      rosterConfig: own || seriesRoster ? { studentIds: (own || seriesRoster).studentIds || [], groups: (own || seriesRoster).groups || [] } : { studentIds: [], groups: [] },
    };
  },

  /** 编辑单节课程 */
  async 'class.update'(ctx, data) {
    ctx.require(P.CLASS_MANAGE);
    const cls = await ctx.store.get('classes', v.id(data.classId, '课程'));
    if (!cls) throw E.notFound('课程');
    if (cls.status === 'cancelled') throw E.rule('CLASS_CANCELLED', '已取消的课程不能编辑');
    const patch = {};
    if (data.name !== undefined) patch.name = v.str(data.name, '课程名称', { max: 40 });
    if (data.teacherId !== undefined && data.teacherId !== cls.teacherId) {
      const t = await getActiveTeacher(ctx.store, data.teacherId);
      patch.teacherId = t._id;
      patch.teacherName = t.name;
    }
    if (data.capacity !== undefined) patch.capacity = v.int(data.capacity, '人数上限', { optional: true, default: null, min: 1, max: 999 });
    if (data.description !== undefined) patch.description = v.str(data.description, '课程简介', { optional: true, max: 500 });
    if (data.room !== undefined) patch.room = v.str(data.room, '教室', { optional: true, max: 20 });
    if (data.level !== undefined) patch.level = v.int(data.level, '难度', { optional: true, default: 0, min: 0, max: 5 });
    if (data.videoFileId !== undefined) {
      const nv = videoFileId(ctx, data.videoFileId, cls.videoFileId || '');
      if (nv !== (cls.videoFileId || '')) patch.videoFileId = nv;
    }
    const date = data.date !== undefined ? v.date(data.date, '上课日期') : cls.date;
    const startTime = data.startTime !== undefined ? v.time(data.startTime, '开始时间') : cls.startTime;
    const duration = data.duration !== undefined ? v.int(data.duration, '课程时长', { min: 15, max: 480 }) : cls.duration;
    if (date !== cls.date || startTime !== cls.startTime || duration !== cls.duration) {
      const hasAttendance = await ctx.store.count('attendance', { classId: cls._id, status: 'present' });
      if (hasAttendance && date !== cls.date) throw E.rule('HAS_ATTENDANCE', '已有学员签到，不能修改上课日期');
      if (date < time.today()) throw E.invalid('不能改到过去的日期');
      Object.assign(patch, { date, startTime, duration }, computeTimes(date, startTime, duration));
    }
    if (!Object.keys(patch).length) return { updated: false };
    patch.updatedAt = time.now();
    await ctx.store.update('classes', cls._id, patch);
    // 仅修改本节课；旧视频若不再被任何课程引用则从云存储删除
    if (patch.videoFileId !== undefined && cls.videoFileId) await releaseVideo(ctx, cls.videoFileId);
    if (patch.name || patch.teacherId || patch.date || patch.startTime) {
      const atts = await ctx.store.find('attendance', { classId: cls._id });
      for (const a of atts) {
        await ctx.store.update('attendance', a._id, {
          className: patch.name || cls.name, teacherId: patch.teacherId || cls.teacherId, teacherName: patch.teacherName || cls.teacherName,
          classDate: date, startTime, endTime: patch.endTime || cls.endTime,
        });
      }
    }
    await ctx.audit('class.update', 'class', cls._id, views.classView(cls), patch, v.str(data.reason, '原因', { optional: true, max: 200 }));
    return { updated: true };
  },

  async 'class.cancel'(ctx, data) {
    ctx.require(P.CLASS_CANCEL);
    const cls = await ctx.store.get('classes', v.id(data.classId, '课程'));
    if (!cls) throw E.notFound('课程');
    if (cls.status === 'cancelled') throw E.rule('CLASS_CANCELLED', '课程已取消');
    const reason = v.str(data.reason, '取消原因', { max: 200 });
    const refund = !!ctx.settings.membership.refundOnCancel;
    const r = await cancelOne(ctx, cls, reason, refund);
    return { ...r, refundPolicy: refund };
  },

  /** 取消整个批次中尚未结束的课程；已结束课程及其出勤记录保持不变 */
  async 'class.cancelSeries'(ctx, data) {
    ctx.require(P.CLASS_CANCEL);
    const series = await ctx.store.get('classSeries', v.id(data.seriesId, '排课批次'));
    if (!series) throw E.notFound('排课批次');
    const reason = v.str(data.reason, '取消原因', { max: 200 });
    const refund = !!ctx.settings.membership.refundOnCancel;
    const nowMs = time.now();
    const classes = await ctx.store.find('classes', { seriesId: series._id, status: 'scheduled' });
    let cancelled = 0;
    let refunded = 0;
    for (const c of classes) {
      if (c.endAt <= nowMs) continue;
      const r = await cancelOne(ctx, c, reason, refund);
      cancelled += 1;
      refunded += r.refunded;
    }
    await ctx.store.update('classSeries', series._id, { status: 'cancelled', cancelledAt: nowMs, cancelReason: reason });
    await ctx.audit('series.cancel', 'classSeries', series._id, null, { cancelled, refunded }, reason);
    return { cancelled, refunded, refundPolicy: refund };
  },

  /** 设置上课名单：target=class 仅本节，target=series 整个批次 */
  async 'roster.set'(ctx, data) {
    ctx.require(P.ROSTER_MANAGE);
    const cls = await ctx.store.get('classes', v.id(data.classId, '课程'));
    if (!cls) throw E.notFound('课程');
    ctx.assertClassAccess(cls);
    const target = v.oneOf(data.target, '名单范围', ['class', 'series'], { optional: true, default: 'class' });
    const studentIds = v.ids(data.studentIds || [], '名单学员');
    const groups = (data.groups || []).map((g) => v.str(g, '分组', { max: 20 }));
    if (studentIds.length) {
      const found = await ctx.store.find('students', { _id: { $in: studentIds } });
      if (found.length !== studentIds.length) throw E.invalid('名单中包含不存在的学员');
    }
    const rosterId = target === 'series' && cls.seriesId ? `series_${cls.seriesId}` : `class_${cls._id}`;
    const ts = time.now();
    if (!studentIds.length && !groups.length) await ctx.store.remove('attendanceRosters', rosterId);
    else {
      await ctx.store.set('attendanceRosters', rosterId, {
        ...(rosterId.startsWith('series_') ? { seriesId: cls.seriesId } : { classId: cls._id }),
        studentIds, groups, updatedBy: ctx.user._id, updatedAt: ts,
      });
    }
    await ctx.audit('roster.set', 'attendanceRoster', rosterId, null, { count: studentIds.length, groups }, '');
    const resolved = await resolveRoster(ctx.store, cls);
    return { rosterId, count: resolved ? resolved.studentIds.length : 0 };
  },

  /** 按分组读取在籍学员（用于名单页「按分组添加」预览） */
  async 'roster.groupMembers'(ctx, data) {
    ctx.require(P.ROSTER_MANAGE);
    const groups = (Array.isArray(data.groups) ? data.groups : []).map((g) => v.str(g, '分组', { max: 20 }));
    if (!groups.length) return { items: [] };
    const seen = new Map();
    for (const g of groups) {
      const list = await ctx.store.find('students', { groups: { $contains: g }, status: 'active' });
      list.forEach((s) => seen.set(s._id, s));
    }
    return { items: [...seen.values()].map(views.studentForTeacher) };
  },

  /** 教师下拉列表（排课用） */
  async 'class.teacherOptions'(ctx) {
    ctx.require(P.CLASS_MANAGE);
    const list = await ctx.store.find('teachers', { status: 'active' }, { orderBy: [['name', 'asc']] });
    return list.map((t) => ({ _id: t._id, name: t.name }));
  },
};

module.exports._generateDates = generateDates;
