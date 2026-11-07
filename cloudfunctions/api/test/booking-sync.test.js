'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const raw = (env, openid, action, data) => env.handle({ action, data }, openid);

test('S1. 预约/取消/签到与老师端人数一致（以数据库记录为准）', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  await env.givePass(env.student2Id, 5);
  const c = await env.createClass({ startTime: '18:00', capacity: 10 });
  const classId = c.classes[0]._id;
  const detail = () => env.ok('teacher-openid', 'attendance.classDetail', { classId });
  const dash = async () => (await env.ok('teacher-openid', 'teacher.dashboard', {})).classes.find((x) => x._id === classId);

  let d = await detail();
  assert.equal(d.stats.booked, 0);
  assert.equal(d.stats.notCheckedIn, null);

  await env.ok('student-openid', 'booking.create', { classId });
  await env.ok('student2-openid', 'booking.create', { classId });
  d = await detail();
  assert.equal(d.stats.booked, 2);
  assert.equal(d.stats.checkedIn, 2, '预约即签到');
  assert.equal(d.stats.notCheckedIn, 0);
  assert.equal(d.notCheckedIn.length, 0);
  let s = await dash();
  assert.equal(s.booked, 2);
  assert.equal(s.notCheckedIn, 0);

  // 学员端：真实预约人数与头像
  const week = await env.ok('student-openid', 'schedule.week', {});
  const card = week.classes.find((x) => x._id === classId);
  assert.equal(card.bookedCount, 2);
  assert.equal(card.bookedStudents.length, 2);
  assert.equal(card.phase, 'upcoming');
  const sd = await env.ok('student-openid', 'schedule.classDetail', { classId });
  assert.equal(sd.class.bookedCount, 2);
  assert.equal(sd.class.state, 'checked_in');

  // 重复预约不改变计数
  const dup = await raw(env, 'student-openid', 'booking.create', { classId });
  assert.equal(dup.code, 'ALREADY_BOOKED');
  assert.equal((await detail()).stats.booked, 2);

  // 老师对已预约（已签到）学员再次代签：被拒绝，不重复扣课时
  const again = await raw(env, 'teacher-openid', 'attendance.mark', { classId, studentId: env.studentId, status: 'present', reason: '到场' });
  assert.equal(again.ok, false);
  d = await detail();
  assert.equal(d.stats.checkedIn, 2);
  s = await dash();
  assert.equal(s.checkedIn, 2);
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 4, '预约时扣一次，仅扣一次');

  // 取消预约：预约数与已签到数各 -1，课时退还
  await env.ok('student2-openid', 'booking.cancel', { classId });
  d = await detail();
  assert.equal(d.stats.booked, 1);
  assert.equal(d.stats.checkedIn, 1);
  assert.equal(d.stats.notCheckedIn, 0);
  assert.equal((await env.store.get('classes', classId)).bookedCount, 1);
  const m2 = await env.ok('student2-openid', 'membership.mine');
  assert.equal(m2.memberships[0].remainingCredits, 5, '取消后退还课时');
  assert.equal(d.cancelled.length, 1);
  assert.equal(d.cancelled[0].studentId, env.student2Id);
  assert.ok(!d.notCheckedIn.some((r) => r.studentId === env.student2Id), '已取消不进入当前名单');
});

test('S2. 按分组添加学员：老师可设置名单，不自动签到；未授权课程被拒绝', async () => {
  const env = await setup();
  await env.ok('owner-openid', 'student.update', { studentId: env.student2Id, groups: ['周末班'] });
  const c = await env.createClass({ startTime: '18:00' });
  const classId = c.classes[0]._id;
  const groups = await env.ok('teacher-openid', 'student.groups', {});
  assert.deepEqual(groups, ['周末班']);
  const gm = await env.ok('teacher-openid', 'roster.groupMembers', { groups: ['周末班'] });
  assert.deepEqual(gm.items.map((x) => x._id), [env.student2Id]);
  const r = await env.ok('teacher-openid', 'roster.set', { classId, groups: ['周末班'], studentIds: [] });
  assert.equal(r.count, 1);
  const d = await env.ok('teacher-openid', 'attendance.classDetail', { classId });
  assert.equal(d.stats.checkedIn, 0, '添加学员不会自动签到');
  assert.equal(d.stats.notCheckedIn, 1);
  assert.equal(d.notCheckedIn[0].studentId, env.student2Id);
  // 老师可查看分组带入的学员
  await env.ok('teacher-openid', 'student.get', { studentId: env.student2Id });
  // 其他老师的课程不可设置名单
  const other = await env.createClass({ teacherId: env.teacher2Id, startTime: '20:00' });
  const denied = await raw(env, 'teacher-openid', 'roster.set', { classId: other.classes[0]._id, groups: ['周末班'] });
  assert.equal(denied.ok, false);
  // 老师无店主管理权限
  const noMgr = await raw(env, 'teacher-openid', 'class.create', { mode: 'single', name: 'x', teacherId: env.teacherId, date: '2024-06-05', startTime: '10:00', duration: 60, requestId: 'r-x' });
  assert.equal(noMgr.ok, false);
});
