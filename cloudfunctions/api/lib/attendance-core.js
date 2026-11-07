'use strict';
/**
 * 签到核心：所有出勤状态变化（自助签到、教师手动签到/更正、课程取消退课时）都经由此处，
 * 在单个数据库事务中完成「校验 → 扣减 → 流水 → 签到记录」，失败整体回滚，绝不误扣课时。
 */
const time = require('./time');
const ids = require('./ids');
const { E, AppError } = require('./errors');
const rules = require('./membership-rules');
const booking = require('./booking-core');

const MAX_RETRY = 5;

async function withRetry(fn) {
  let last;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String((e && (e.code || e.errMsg || e.message)) || '');
      if (!/TX_CONFLICT|conflict|WriteConflict|-502003/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * (i + 1)));
    }
  }
  if (last instanceof AppError && last.code === 'TX_CONFLICT') {
    throw E.conflict('BUSY', '当前操作人数较多，请稍后重试');
  }
  throw last;
}

/** 签到时间窗口 */
function checkInWindow(cls, settings) {
  const open = cls.startAt - settings.checkin.openBeforeMinutes * 60000;
  const close = Math.min(cls.endAt, cls.startAt + settings.checkin.closeAfterStartMinutes * 60000);
  return { open, close };
}

function assertClassCheckable(cls, settings, enforceWindow) {
  if (!cls) throw E.notFound('课程');
  if (cls.status === 'cancelled') throw E.rule('CLASS_CANCELLED', '课程已取消，无法签到');
  if (!enforceWindow) return;
  const nowMs = time.now();
  const w = checkInWindow(cls, settings);
  if (nowMs < w.open) throw E.rule('CHECKIN_NOT_OPEN', `签到将于开课前${settings.checkin.openBeforeMinutes}分钟开放`);
  if (nowMs > w.close) throw E.rule(nowMs >= cls.endAt ? 'CLASS_ENDED' : 'CHECKIN_CLOSED', nowMs >= cls.endAt ? '课程已结束' : '签到已截止');
}

/**
 * 标记出勤（present）。
 * opts: { classId, studentId, operatorId, source: 'self'|'manual', reason, enforceWindow, settings }
 */
async function markPresent(store, opts) {
  const { classId, studentId, operatorId, source, reason, enforceWindow, settings, requireNotStarted } = opts;
  // 事务中不支持条件查询：先查出候选会员卡 ID，再在事务中逐一重新读取以获得一致性快照
  const candidates = await store.find('memberships', { studentId, status: { $in: ['active', 'suspended', 'expired'] } });
  const attId = ids.attendanceId(classId, studentId);

  return withRetry(() => store.transaction(async (tx) => {
    const cls = await tx.get('classes', classId);
    assertClassCheckable(cls, settings, enforceWindow);
    if (requireNotStarted && time.now() >= cls.startAt) throw E.rule('CLASS_STARTED', '课程已开始或已结束，不能预约');

    const student = await tx.get('students', studentId);
    if (!student || student.status === 'deleted') throw E.notFound('学员');
    if (student.status === 'suspended') throw E.rule('STUDENT_SUSPENDED', '学员账户已停用');

    const existing = await tx.get('attendance', attId);
    if (existing && existing.status === 'present') throw E.conflict('ALREADY_CHECKED_IN', '已签到，请勿重复签到');

    const ms = [];
    for (const c of candidates) {
      const m = await tx.get('memberships', c._id);
      if (m && m.studentId === studentId) ms.push(m);
    }
    const { membership, reason: why } = rules.pickMembership(ms, cls.date);
    if (!membership) throw E.rule(why, rules.REASON_TEXT[why]);

    const ts = time.now();
    // 关联预约：已预约 → 已签到；未预约的临时到场学员自动补一条预约记录。本人签到受容量限制，教师代签不受限
    const bk = await booking.upsertBooking(tx, cls, student, {
      source: source === 'self' ? 'self' : 'teacher', operatorId, enforceCapacity: source === 'self', status: 'checked_in', checkedInAt: ts,
    });

    const deduction = await rules.deductForAttendance(tx, membership, cls.date, operatorId, attId,
      source === 'manual' ? `教师代签：${reason || ''}`.trim() : '上课签到');
    const entry = { at: ts, operatorId, from: existing ? existing.status : 'none', to: 'present', reason: reason || (source === 'self' ? '学员签到' : '') };
    const doc = {
      classId, studentId,
      className: cls.name, teacherId: cls.teacherId, teacherName: cls.teacherName,
      classDate: cls.date, startTime: cls.startTime, endTime: cls.endTime,
      studentName: student.name, studentAvatar: student.avatar || '',
      status: 'present', source, checkInType: source === 'self' ? 'self' : 'teacher_proxy',
      operatorId, bookingId: bk.booking.bookingId || booking.bookingId(classId, studentId),
      checkInAt: ts, deduction,
      history: [...((existing && existing.history) || []), entry],
      createdAt: existing ? existing.createdAt : ts, updatedAt: ts,
    };
    if (existing) await tx.set('attendance', attId, doc);
    else await tx.create('attendance', { _id: attId, ...doc });
    return { attendanceId: attId, checkInAt: ts, membershipId: membership._id, deduction };
  })).then(async (r) => {
    await rules.refreshSummary(store, studentId).catch(() => null);
    return r;
  });
}

/** 将出勤更正为缺勤（absent），按扣减记录退还 */
async function markAbsent(store, opts) {
  const { classId, studentId, operatorId, reason } = opts;
  const attId = ids.attendanceId(classId, studentId);
  const r = await withRetry(() => store.transaction(async (tx) => {
    const cls = await tx.get('classes', classId);
    if (!cls) throw E.notFound('课程');
    const student = await tx.get('students', studentId);
    if (!student) throw E.notFound('学员');
    const existing = await tx.get('attendance', attId);
    if (existing && existing.status === 'absent') throw E.conflict('ALREADY_ABSENT', '该学员已是未到状态');
    const ts = time.now();
    if (existing && existing.status === 'present') {
      await rules.refundAttendance(tx, existing.deduction, studentId, operatorId, attId, `签到更正为缺勤：${reason}`);
      await booking.revertCheckIn(tx, classId, studentId, operatorId, reason);
    }
    const entry = { at: ts, operatorId, from: existing ? existing.status : 'none', to: 'absent', reason };
    const doc = {
      classId, studentId,
      className: cls.name, teacherId: cls.teacherId, teacherName: cls.teacherName,
      classDate: cls.date, startTime: cls.startTime, endTime: cls.endTime,
      studentName: student.name, studentAvatar: student.avatar || '',
      status: 'absent', source: 'manual', checkInAt: null, deduction: null,
      history: [...((existing && existing.history) || []), entry],
      createdAt: existing ? existing.createdAt : ts, updatedAt: ts,
    };
    if (existing) await tx.set('attendance', attId, doc);
    else await tx.create('attendance', { _id: attId, ...doc });
    return { attendanceId: attId, from: entry.from };
  }));
  await rules.refreshSummary(store, studentId).catch(() => null);
  return r;
}

/**
 * 学员取消预约：同一事务内「取消预约 + 出勤标记为 cancelled + 按原扣减记录退还 + 写退款流水」。
 * 出勤状态由 present 变为 cancelled 后不会再次退款，保证退款幂等。
 */
async function cancelBookingWithRefund(store, opts) {
  const { classId, studentId, operatorId, cutoffMinutes, reason } = opts;
  const attId = ids.attendanceId(classId, studentId);
  const r = await withRetry(() => store.transaction(async (tx) => {
    const cls = await tx.get('classes', classId);
    if (!cls) throw E.notFound('课程');
    if (time.now() >= cls.startAt - (cutoffMinutes || 0) * 60000) {
      throw E.rule('CANCEL_CLOSED', `开课前${cutoffMinutes}分钟内不能取消预约`);
    }
    const res = await booking.cancelBooking(tx, cls, studentId, operatorId, reason);
    const att = await tx.get('attendance', attId);
    let refunded = false;
    if (att && att.status === 'present') {
      await rules.refundAttendance(tx, att.deduction, studentId, operatorId, attId, `取消预约退还：${cls.name}`);
      const ts = time.now();
      await tx.update('attendance', attId, {
        status: 'cancelled', refunded: true, refundedAt: ts,
        history: [...(att.history || []), { at: ts, operatorId, from: 'present', to: 'cancelled', reason: reason || '取消预约' }],
        updatedAt: ts,
      });
      refunded = true;
    }
    return { ...res, refunded };
  }));
  await rules.refreshSummary(store, studentId).catch(() => null);
  return r;
}

/** 课程取消：保留出勤记录（状态改为 class_cancelled），按策略退还 */
async function cancelClassAttendance(store, cls, operatorId, refund, reason) {
  const list = await store.find('attendance', { classId: cls._id, status: 'present' });
  let refunded = 0;
  for (const a of list) {
    await withRetry(() => store.transaction(async (tx) => {
      const cur = await tx.get('attendance', a._id);
      if (!cur || cur.status !== 'present') return;
      if (refund) await rules.refundAttendance(tx, cur.deduction, cur.studentId, operatorId, cur._id, `课程取消退还：${reason || ''}`.trim());
      const ts = time.now();
      await tx.update('attendance', cur._id, {
        status: 'class_cancelled',
        refunded: !!refund,
        history: [...(cur.history || []), { at: ts, operatorId, from: 'present', to: 'class_cancelled', reason: reason || '课程取消' }],
        updatedAt: ts,
      });
    }));
    if (refund) refunded += 1;
    await rules.refreshSummary(store, a.studentId).catch(() => null);
  }
  // 预约记录保留，状态改为「已取消」并注明原因
  const bookings = await store.find('classBookings', { classId: cls._id, status: { $in: ['booked', 'checked_in', 'completed'] } });
  for (const b of bookings) {
    const ts = time.now();
    await store.update('classBookings', b._id, {
      status: 'cancelled', cancelledAt: ts, cancelledBy: operatorId, cancelReason: `课程取消：${reason || ''}`.trim(), classCancelled: true,
      history: [...(b.history || []), { at: ts, operatorId, from: b.status, to: 'cancelled', reason: reason || '课程取消' }],
      updatedAt: ts,
    });
  }
  return { affected: list.length, refunded, bookingsCancelled: bookings.length };
}

module.exports = { withRetry, checkInWindow, assertClassCheckable, markPresent, markAbsent, cancelBookingWithRefund, cancelClassAttendance };
