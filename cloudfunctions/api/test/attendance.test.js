'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, reqId } = require('./helpers');
const time = require('../lib/time');

test('10. 签到成功：生成签到记录、扣一课时、写入流水', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 10);
  const c = await env.createClass();
  const classId = c.classes[0]._id;
  const r = await env.ok('student-openid', 'attendance.checkIn', { classId });
  assert.ok(r.checkInAt);
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 9);
  assert.equal(m.memberships[0].usedCredits, 1);
  assert.equal(m.summary.remainingCredits, 9);
  const week = await env.ok('student-openid', 'schedule.week', {});
  const card = week.classes.find((x) => x._id === classId);
  assert.equal(card.state, 'checked_in');
  assert.equal(card.canCheckIn, false);
});

test('11. 防止重复签到', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 10);
  const c = await env.createClass();
  const classId = c.classes[0]._id;
  await env.ok('student-openid', 'attendance.checkIn', { classId });
  const r = await env.call('student-openid', 'attendance.checkIn', { classId });
  assert.equal(r.code, 'ALREADY_CHECKED_IN');
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 9);
});

test('12. 课时不足被拒绝且不扣课时；课表显示「课时不足」', async () => {
  const env = await setup();
  const { membershipId } = await env.givePass(env.studentId, 1);
  const c1 = await env.createClass();
  const c2 = await env.createClass({ startTime: '10:45' });
  await env.ok('student-openid', 'attendance.checkIn', { classId: c1.classes[0]._id });
  const r = await env.call('student-openid', 'attendance.checkIn', { classId: c2.classes[0]._id });
  assert.equal(r.code, 'INSUFFICIENT_CREDITS');
  assert.equal(r.message, '课时不足');
  const week = await env.ok('student-openid', 'schedule.week', {});
  const card = week.classes.find((x) => x._id === c2.classes[0]._id);
  assert.equal(card.state, 'insufficient');
  assert.equal(card.hint, '课时不足');
  const tx = await env.ok('admin-openid', 'transaction.list', { studentId: env.studentId });
  assert.equal(tx.items.filter((t) => t.type === 'attendance_deduction').length, 1);
  assert.ok(membershipId);
  // 无会员卡
  const none = await env.call('student2-openid', 'attendance.checkIn', { classId: c2.classes[0]._id });
  assert.equal(none.code, 'NO_MEMBERSHIP');
});

test('13. 会员卡过期被拒绝', async () => {
  const env = await setup();
  await env.ok('admin-openid', 'membership.create', {
    studentId: env.studentId, type: 'pass', credits: 10, startDate: '2024-01-01', expireDate: '2024-06-02', requestId: reqId(),
  });
  const c = await env.createClass();
  const r = await env.call('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  assert.equal(r.code, 'MEMBERSHIP_EXPIRED');
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 10);
  // 每日任务标记过期并写入过期流水
  const handleInternal = require('../app').createApi(env.store, { logger: false });
  const d = await handleInternal({ action: 'maintenance.daily' }, null, { internal: true });
  assert.equal(d.data.expired, 1);
  const tx = await env.ok('admin-openid', 'transaction.list', { studentId: env.studentId, type: 'expiration' });
  assert.equal(tx.items[0].amount, -10);
  assert.equal(tx.items[0].newBalance, 0);
});

test('14. 已取消课程签到被拒绝', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 10);
  const c = await env.createClass();
  await env.ok('admin-openid', 'class.cancel', { classId: c.classes[0]._id, reason: '停电' });
  const r = await env.call('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  assert.equal(r.code, 'CLASS_CANCELLED');
  const week = await env.ok('student-openid', 'schedule.week', {});
  assert.equal(week.classes.find((x) => x._id === c.classes[0]._id).state, 'cancelled');
});

test('签到时间窗口：过早/已结束拒绝；已结束课程从课表消失', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 10);
  const c = await env.createClass({ startTime: '18:00' });
  const early = await env.call('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  assert.equal(early.code, 'CHECKIN_NOT_OPEN');
  env.setNow(time.toMs('2024-06-03', '19:01'));
  const late = await env.call('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  assert.equal(late.code, 'CLASS_ENDED');
  const week = await env.ok('student-openid', 'schedule.week', {});
  assert.equal(week.classes.find((x) => x._id === c.classes[0]._id), undefined);
});

test('月卡：不限次与每月限次策略', async () => {
  const env = await setup();
  await env.ok('admin-openid', 'membership.create', { studentId: env.studentId, type: 'monthly', months: 1, policyMode: 'unlimited', requestId: reqId() });
  await env.ok('admin-openid', 'membership.create', { studentId: env.student2Id, type: 'monthly', months: 1, policyMode: 'limited', monthlyLimit: 1, requestId: reqId() });
  const c1 = await env.createClass();
  const c2 = await env.createClass({ startTime: '10:40' });
  await env.ok('student-openid', 'attendance.checkIn', { classId: c1.classes[0]._id });
  await env.ok('student-openid', 'attendance.checkIn', { classId: c2.classes[0]._id });
  await env.ok('student2-openid', 'attendance.checkIn', { classId: c1.classes[0]._id });
  const r = await env.call('student2-openid', 'attendance.checkIn', { classId: c2.classes[0]._id });
  assert.equal(r.code, 'MONTHLY_LIMIT_REACHED');
  const m = await env.ok('student2-openid', 'membership.mine');
  assert.equal(m.memberships[0].monthUsed, 1);
  assert.equal(m.memberships[0].expireDate, '2024-07-02');
});

test('15. 教师手动签到与更正：记录操作人、时间、原状态、新状态、原因', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  const c = await env.createClass();
  const classId = c.classes[0]._id;
  const noReason = await env.call('teacher-openid', 'attendance.mark', { classId, studentId: env.studentId, status: 'present' });
  assert.equal(noReason.code, 'INVALID_ARGUMENT');
  await env.ok('teacher-openid', 'attendance.mark', { classId, studentId: env.studentId, status: 'present', reason: '手机没电' });
  let m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 4);
  await env.ok('teacher-openid', 'attendance.mark', { classId, studentId: env.studentId, status: 'absent', reason: '误签' });
  m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 5, '更正为缺勤退还课时');
  const d = await env.ok('teacher-openid', 'attendance.classDetail', { classId });
  const row = d.others[0];
  assert.equal(row.status, 'absent');
  assert.deepEqual(row.history.map((h) => [h.from, h.to, h.reason]), [['none', 'present', '手机没电'], ['present', 'absent', '误签']]);
  const att = await env.store.get('attendance', `${classId}_${env.studentId}`);
  assert.ok(att.history.every((h) => h.operatorId && h.at));
  const audit = await env.ok('owner-openid', 'audit.list', { targetType: 'attendance' });
  assert.equal(audit.items.length, 2);
  assert.equal(audit.items[0].reason, '误签');
  assert.equal(audit.items[0].actorName, '林老师');
  // 学员本人随后仍可自助签到
  await env.ok('student-openid', 'attendance.checkIn', { classId });
});

test('16. 课时流水完整性：每次变动都有流水，余额链连续', async () => {
  const env = await setup();
  const { membershipId } = await env.givePass(env.studentId, 5);
  await env.ok('admin-openid', 'membership.adjustCredits', { membershipId, delta: 3, reason: '赠送' });
  const neg = await env.call('admin-openid', 'membership.adjustCredits', { membershipId, delta: -100, reason: '错误' });
  assert.equal(neg.code, 'INSUFFICIENT_CREDITS');
  const noReason = await env.call('admin-openid', 'membership.adjustCredits', { membershipId, delta: -1 });
  assert.equal(noReason.code, 'INVALID_ARGUMENT');
  await env.ok('admin-openid', 'membership.adjustCredits', { membershipId, delta: -2, reason: '转让' });
  const c = await env.createClass();
  await env.ok('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  await env.ok('admin-openid', 'membership.renew', { membershipId, credits: 10, days: 30 });
  const tx = (await env.ok('owner-openid', 'transaction.list', { studentId: env.studentId })).items.reverse();
  assert.deepEqual(tx.map((t) => t.type), ['purchase', 'credit_add', 'manual_deduction', 'attendance_deduction', 'renewal']);
  for (let i = 0; i < tx.length; i++) {
    assert.equal(tx[i].newBalance, tx[i].previousBalance + tx[i].amount, `第${i}条流水金额一致`);
    if (i > 0) assert.equal(tx[i].previousBalance, tx[i - 1].newBalance, `第${i}条流水余额连续`);
    assert.ok(tx[i].operatorName);
  }
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, tx[tx.length - 1].newBalance);
  assert.equal(m.memberships[0].expireDate, time.addDays('2024-11-30', 30));
});

test('17. 签到记录：筛选与倒序', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 20);
  const r = await env.ok('admin-openid', 'class.create', {
    mode: 'multi', name: '民族舞', teacherId: env.teacherId, dates: ['2024-06-03', '2024-06-06', '2024-06-12', '2024-07-01'], startTime: '10:30', duration: 60, requestId: reqId(),
  });
  const list = (await env.ok('admin-openid', 'class.list', { from: '2024-06-01', to: '2024-07-31' })).classes.filter((c) => c.seriesId === r.seriesId);
  for (const c of list) {
    env.setNow(time.toMs(c.date, '10:00'));
    await env.ok('student-openid', 'attendance.checkIn', { classId: c._id });
  }
  env.setNow(time.toMs('2024-07-01', '12:00'));
  const all = await env.ok('student-openid', 'attendance.myHistory', { range: 'all' });
  assert.deepEqual(all.items.map((a) => a.classDate), ['2024-07-01', '2024-06-12', '2024-06-06', '2024-06-03']);
  assert.equal(all.items[0].teacherName, '林老师');
  const week = await env.ok('student-openid', 'attendance.myHistory', { range: 'week' });
  assert.equal(week.items.length, 1);
  const month = await env.ok('student-openid', 'attendance.myHistory', { range: 'month' });
  assert.equal(month.items.length, 1);
  const custom = await env.ok('student-openid', 'attendance.myHistory', { range: 'custom', from: '2024-06-01', to: '2024-06-10' });
  assert.deepEqual(custom.items.map((a) => a.classDate), ['2024-06-06', '2024-06-03']);
  const bad = await env.call('student-openid', 'attendance.myHistory', { range: 'custom', from: '2024-06-10', to: '2024-06-01' });
  assert.equal(bad.code, 'INVALID_ARGUMENT');
  // 其他学员看不到
  const other = await env.ok('student2-openid', 'attendance.myHistory', {});
  assert.equal(other.items.length, 0);
});

test('18. 周课表导航：默认本周、可看未来周、禁止以往周、必须为周一', async () => {
  const env = await setup({ now: time.toMs('2024-06-05', '09:00') });
  const w = await env.ok('student-openid', 'schedule.week', {});
  assert.equal(w.weekStart, '2024-06-03');
  assert.equal(w.weekEnd, '2024-06-09');
  assert.equal(w.today, '2024-06-05');
  const next = await env.ok('student-openid', 'schedule.week', { weekStart: '2024-06-10' });
  assert.equal(next.weekStart, '2024-06-10');
  const prev = await env.call('student-openid', 'schedule.week', { weekStart: '2024-05-27' });
  assert.equal(prev.code, 'PAST_WEEK');
  const notMonday = await env.call('student-openid', 'schedule.week', { weekStart: '2024-06-11' });
  assert.equal(notMonday.code, 'INVALID_ARGUMENT');
});

test('20. 并发签到：同一学员并发请求只成功一次、只扣一次课时', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 10);
  const c = await env.createClass();
  const classId = c.classes[0]._id;
  const results = await Promise.all(Array.from({ length: 10 }, () => env.call('student-openid', 'attendance.checkIn', { classId })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  results.filter((r) => !r.ok).forEach((r) => assert.ok(['ALREADY_CHECKED_IN', 'BUSY'].includes(r.code), r.code));
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 9);
  const tx = await env.ok('admin-openid', 'transaction.list', { studentId: env.studentId, type: 'attendance_deduction' });
  assert.equal(tx.items.length, 1);
});

test('20b. 并发签到：仅剩 1 课时时两节课同时签到，只成功一次，余额不为负', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 1);
  const c1 = await env.createClass();
  const c2 = await env.createClass({ startTime: '10:40' });
  const rs = await Promise.all([
    env.call('student-openid', 'attendance.checkIn', { classId: c1.classes[0]._id }),
    env.call('student-openid', 'attendance.checkIn', { classId: c2.classes[0]._id }),
  ]);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 0);
});

test('20c. 并发：多名学员同时签到同一课程全部成功', async () => {
  const env = await setup();
  const openids = [];
  for (let i = 0; i < 8; i++) {
    const oid = `bulk-${i}`;
    const { studentId } = await env.registerStudent(oid, { name: `学员${i}` });
    await env.givePass(studentId, 3);
    openids.push(oid);
  }
  const c = await env.createClass();
  const rs = await Promise.all(openids.map((o) => env.call(o, 'attendance.checkIn', { classId: c.classes[0]._id })));
  assert.equal(rs.filter((r) => r.ok).length, 8);
  const d = await env.ok('admin-openid', 'attendance.classDetail', { classId: c.classes[0]._id });
  assert.equal(d.stats.checkedIn, 8);
});

test('个人信息：导出与注销（去标识化）', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 2);
  const ex = await env.ok('student-openid', 'profile.export');
  assert.equal(ex.student.name, '小美');
  assert.equal(ex.memberships.length, 1);
  const bad = await env.call('student-openid', 'profile.update', { avatar: 'cloud://env/avatars/someoneelse/a.png' });
  assert.equal(bad.code, 'FORBIDDEN');
  await env.ok('student-openid', 'profile.deleteAccount', { confirm: true });
  const s = await env.ok('student-openid', 'auth.login');
  assert.equal(s.registered, false);
  const stu = await env.store.get('students', env.studentId);
  assert.equal(stu.name, '已注销学员');
  assert.equal(stu.wxid, '');
});
