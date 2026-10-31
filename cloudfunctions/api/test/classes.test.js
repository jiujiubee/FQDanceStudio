'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, reqId } = require('./helpers');
const time = require('../lib/time');
const { _generateDates } = require('../services/classes');

test('7. 创建单次课程：计算结束时间与时间戳（上海时区）', async () => {
  const env = await setup();
  const c = await env.createClass({ date: '2024-06-05', startTime: '19:00', duration: 90 });
  assert.equal(c.created, 1);
  const cls = c.classes[0];
  assert.equal(cls.endTime, '20:30');
  assert.equal(cls.startAt, Date.UTC(2024, 5, 5, 11, 0));
  assert.equal(cls.teacherName, '林老师');
  const past = await env.call('admin-openid', 'class.create', { mode: 'single', name: 'x', teacherId: env.teacherId, date: '2024-06-01', startTime: '10:00', duration: 60, requestId: reqId() });
  assert.equal(past.code, 'INVALID_ARGUMENT');
  const cross = await env.call('admin-openid', 'class.create', { mode: 'single', name: 'x', teacherId: env.teacherId, date: '2024-06-05', startTime: '23:30', duration: 60, requestId: reqId() });
  assert.equal(cross.code, 'INVALID_ARGUMENT');
});

test('8. 每周重复排课：按星期生成，幂等且防止重复生成', async () => {
  const env = await setup();
  const rq = reqId();
  const data = { mode: 'weekly', name: '芭蕾', teacherId: env.teacherId, weekdays: [1, 3], startDate: '2024-06-03', endDate: '2024-06-30', startTime: '18:00', duration: 60, requestId: rq };
  const r = await env.ok('admin-openid', 'class.create', data);
  assert.equal(r.created, 8);
  const list = await env.ok('admin-openid', 'class.list', { from: '2024-06-01', to: '2024-06-30' });
  assert.deepEqual(list.classes.map((c) => c.date), ['2024-06-03', '2024-06-05', '2024-06-10', '2024-06-12', '2024-06-17', '2024-06-19', '2024-06-24', '2024-06-26']);
  list.classes.forEach((c) => assert.ok([1, 3].includes(time.weekday(c.date))));
  // 同一请求重复提交：幂等
  const again = await env.ok('admin-openid', 'class.create', data);
  assert.equal(again.idempotent, true);
  // 新请求但时间完全重复：跳过已存在的
  const dup = await env.call('admin-openid', 'class.create', { ...data, requestId: reqId() });
  assert.equal(dup.code, 'DUPLICATE_CLASS');
  const partial = await env.ok('admin-openid', 'class.create', { ...data, weekdays: [1, 3, 5], requestId: reqId() });
  assert.equal(partial.created, 4);
  assert.equal(partial.skipped.length, 8);
  assert.equal(list.marks['2024-06-03'], 1);
});

test('9. 多日期排课：去重、排序', async () => {
  const env = await setup();
  const r = await env.ok('admin-openid', 'class.create', {
    mode: 'multi', name: '街舞工作坊', teacherId: env.teacherId, dates: ['2024-06-20', '2024-06-08', '2024-06-20', '2024-07-02'],
    startTime: '15:00', duration: 120, requestId: reqId(),
  });
  assert.equal(r.created, 3);
  assert.deepEqual(_generateDates('multi', { dates: ['2024-06-20', '2024-06-08', '2024-06-20'] }), ['2024-06-08', '2024-06-20']);
  assert.throws(() => _generateDates('multi', { dates: ['2024-02-30'] }));
  assert.throws(() => _generateDates('weekly', { startDate: '2024-06-10', endDate: '2024-06-01', weekdays: [1] }));
});

test('19. 取消课程：保留出勤历史、按策略退还课时；取消整个批次只影响未结束课程', async () => {
  const env = await setup();
  const { membershipId } = await env.givePass(env.studentId, 5);
  const r = await env.ok('admin-openid', 'class.create', {
    mode: 'weekly', name: '现代舞', teacherId: env.teacherId, weekdays: [1], startDate: '2024-06-03', endDate: '2024-06-24', startTime: '10:30', duration: 60, requestId: reqId(),
  });
  assert.equal(r.created, 4);
  const list = await env.ok('admin-openid', 'class.list', { from: '2024-06-01', to: '2024-06-30' });
  const first = list.classes[0];
  await env.ok('student-openid', 'attendance.checkIn', { classId: first._id });
  let m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 4);

  await env.ok('admin-openid', 'class.cancel', { classId: first._id, reason: '老师生病' });
  m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 5, '退还课时');
  const hist = await env.ok('student-openid', 'attendance.myHistory', {});
  assert.equal(hist.items.length, 1);
  assert.equal(hist.items[0].status, 'class_cancelled', '历史保留');
  const tx = await env.ok('admin-openid', 'transaction.list', { studentId: env.studentId });
  assert.deepEqual(tx.items.map((t) => t.type), ['refund', 'attendance_deduction', 'purchase']);
  const again = await env.call('admin-openid', 'class.cancel', { classId: first._id, reason: 'x' });
  assert.equal(again.code, 'CLASS_CANCELLED');

  // 第二节课在 6/10；时钟推进到 6/10 12:00（已结束），批次取消只取消 6/17、6/24
  env.setNow(time.toMs('2024-06-10', '12:00'));
  const s = await env.ok('admin-openid', 'class.cancelSeries', { seriesId: r.seriesId, reason: '课程调整' });
  assert.equal(s.cancelled, 2);
  const after = await env.ok('admin-openid', 'class.list', { from: '2024-06-01', to: '2024-06-30' });
  assert.deepEqual(after.classes.map((c) => c.status), ['cancelled', 'scheduled', 'cancelled', 'cancelled']);
  assert.ok(membershipId);
});

test('19b. 不退课时策略：取消课程时保留扣减', async () => {
  const env = await setup();
  await env.ok('owner-openid', 'settings.update', { membership: { monthlyDefaultMode: 'unlimited', monthlyDefaultLimit: 8, refundOnCancel: false, passDefaultValidDays: 180 } });
  await env.givePass(env.studentId, 3);
  const c = await env.createClass();
  await env.ok('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  const r = await env.ok('admin-openid', 'class.cancel', { classId: c.classes[0]._id, reason: '场地' });
  assert.equal(r.refunded, 0);
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 2);
});

test('上课名单：有名单时计算未签到；无名单时不把所有学员算作缺勤', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  const c = await env.createClass();
  const classId = c.classes[0]._id;
  await env.ok('student-openid', 'attendance.checkIn', { classId });
  let d = await env.ok('teacher-openid', 'attendance.classDetail', { classId });
  assert.equal(d.hasRoster, false);
  assert.equal(d.notCheckedIn, null);
  assert.equal(d.stats.checkedIn, 1);

  await env.ok('admin-openid', 'roster.set', { classId, studentIds: [env.studentId, env.student2Id] });
  d = await env.ok('teacher-openid', 'attendance.classDetail', { classId });
  assert.equal(d.stats.expected, 2);
  assert.deepEqual(d.notCheckedIn.map((s) => s.name), ['小雅']);

  // 按分组设置批次名单
  await env.ok('admin-openid', 'student.update', { studentId: env.student2Id, groups: ['少儿班'] });
  const c2 = await env.createClass({ startTime: '16:00', rosterGroups: ['少儿班'] });
  const d2 = await env.ok('teacher-openid', 'attendance.classDetail', { classId: c2.classes[0]._id });
  assert.equal(d2.stats.expected, 1);
  const dash = await env.ok('teacher-openid', 'teacher.dashboard', {});
  assert.equal(dash.totals.checkedIn, 1);
  assert.equal(dash.totals.expected, 3);
  assert.equal(dash.totals.notCheckedIn, 2);
});

test('编辑课程：修改时间同步到签到记录；有签到不可改日期', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  const c = await env.createClass();
  const classId = c.classes[0]._id;
  await env.ok('student-openid', 'attendance.checkIn', { classId });
  await env.ok('admin-openid', 'class.update', { classId, name: '爵士进阶', startTime: '10:45', duration: 45 });
  const h = await env.ok('student-openid', 'attendance.myHistory', {});
  assert.equal(h.items[0].className, '爵士进阶');
  assert.equal(h.items[0].endTime, '11:30');
  const r = await env.call('admin-openid', 'class.update', { classId, date: '2024-06-04' });
  assert.equal(r.code, 'HAS_ATTENDANCE');
});
