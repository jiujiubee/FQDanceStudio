'use strict';
/**
 * 课程预约核心。
 * classBookings：_id = bk_<classId>_<studentId>（确定性主键，同一学员同一课程只有一条记录，杜绝重复预约）。
 * 状态：booked（已预约）/ cancelled（已取消）/ checked_in（已签到）/ completed（已完成，课程结束后由每日任务或读取时归档）。
 * 名额：classes.bookedCount 在同一事务中与预约记录一起更新，事务冲突保证并发下不超过容量。
 * 预约与取消都不涉及课时；课时只在签到时由 attendance-core 扣除。
 * 预约记录永不删除，取消/重新预约追加 history。
 */
const time = require('./time');
const { E } = require('./errors');

const ACTIVE = ['booked', 'checked_in', 'completed'];
const bookingId = (classId, studentId) => `bk_${classId}_${studentId}`;

function remainingOf(cls) {
  if (!cls.capacity) return null;
  return Math.max(0, cls.capacity - (cls.bookedCount || 0));
}

/** 展示状态：已签到且课程已结束 → 已完成 */
function displayStatus(b, cls) {
  if (!b) return 'none';
  if (b.status === 'checked_in' && cls && cls.endAt <= time.now()) return 'completed';
  return b.status;
}

function snapshot(cls, student) {
  return {
    className: cls.name, teacherId: cls.teacherId, teacherName: cls.teacherName,
    classDate: cls.date, startTime: cls.startTime, endTime: cls.endTime, classStartAt: cls.startAt,
    studentName: student ? student.name : '',
  };
}

/**
 * 事务内：创建/恢复预约。
 * opts: { source: 'self'|'teacher', operatorId, enforceCapacity, status: 'booked'|'checked_in', checkedInAt }
 * 返回 { booking, created }；已是有效预约时不改变名额。
 */
async function upsertBooking(tx, cls, student, opts) {
  const id = bookingId(cls._id, student._id);
  const cur = await tx.get('classBookings', id);
  const ts = time.now();
  const status = opts.status || 'booked';
  const entry = { at: ts, operatorId: opts.operatorId, from: cur ? cur.status : 'none', to: status, source: opts.source };
  if (cur && ACTIVE.includes(cur.status)) {
    if (status === 'booked') throw E.conflict('ALREADY_BOOKED', '已预约该课程，请勿重复预约');
    if (cur.status !== status) {
      await tx.update('classBookings', id, { status, checkedInAt: opts.checkedInAt || null, history: [...(cur.history || []), entry], updatedAt: ts });
    }
    return { booking: { ...cur, status }, created: false };
  }
  if (opts.enforceCapacity && cls.capacity && (cls.bookedCount || 0) >= cls.capacity) {
    throw E.rule('CLASS_FULL', '课程名额已满');
  }
  const doc = {
    bookingId: id, classId: cls._id, studentId: student._id, userId: student.userId || '',
    ...snapshot(cls, student),
    status, source: opts.source, operatorId: opts.operatorId,
    createdAt: cur ? cur.createdAt : ts, bookedAt: ts, cancelledAt: null, cancelledBy: '', cancelReason: '',
    checkedInAt: status === 'checked_in' ? opts.checkedInAt || ts : null,
    history: [...((cur && cur.history) || []), entry], updatedAt: ts,
  };
  if (cur) await tx.set('classBookings', id, doc);
  else await tx.create('classBookings', { _id: id, ...doc });
  await tx.update('classes', cls._id, { bookedCount: (cls.bookedCount || 0) + 1, updatedAt: ts });
  return { booking: doc, created: true };
}

/** 事务内：取消预约（释放名额）。不删除记录。 */
async function cancelBooking(tx, cls, studentId, operatorId, reason) {
  const id = bookingId(cls._id, studentId);
  const cur = await tx.get('classBookings', id);
  if (!cur || cur.status === 'cancelled') throw E.rule('NOT_BOOKED', '未预约该课程');
  if (!['booked', 'checked_in'].includes(cur.status)) throw E.rule('CANNOT_CANCEL', '该预约当前不可取消');
  const ts = time.now();
  await tx.update('classBookings', id, {
    status: 'cancelled', checkedInAt: null, cancelledAt: ts,
    history: [...(cur.history || []), { at: ts, operatorId, from: cur.status, to: 'cancelled', reason: reason || '' }],
    updatedAt: ts,
  });
  await tx.update('classes', cls._id, { bookedCount: Math.max(0, (cls.bookedCount || 0) - 1), updatedAt: ts });
  return { bookingId: id, cancelledAt: ts };
}

/** 事务内：签到被更正为缺勤 → 预约恢复为「已预约」（名额不变） */
async function revertCheckIn(tx, classId, studentId, operatorId, reason) {
  const id = bookingId(classId, studentId);
  const cur = await tx.get('classBookings', id);
  if (!cur || !['checked_in', 'completed'].includes(cur.status)) return;
  const ts = time.now();
  await tx.update('classBookings', id, {
    status: 'booked', checkedInAt: null,
    history: [...(cur.history || []), { at: ts, operatorId, from: cur.status, to: 'booked', reason: reason || '' }],
    updatedAt: ts,
  });
}

module.exports = { ACTIVE, bookingId, remainingOf, displayStatus, upsertBooking, cancelBooking, revertCheckIn };
