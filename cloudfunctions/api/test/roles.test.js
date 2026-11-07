'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, reqId } = require('./helpers');

test('R1. 店主同时拥有教师角色，并可创建自己的教师档案', async () => {
  const env = await setup();
  await env.ok('owner-openid', 'staff.grantRole', { userId: env.uid('owner-openid'), role: 'teacher' });
  const s = await env.ok('owner-openid', 'auth.login');
  assert.deepEqual([...s.roles].sort(), ['owner', 'student', 'teacher']);
  assert.ok(s.teacher && s.teacher._id);
  const opts = await env.ok('owner-openid', 'class.teacherOptions', {});
  const list = opts.teachers || opts;
  assert.equal(list[0]._id || list[0].teacherId, s.teacher._id);
  await env.ok('owner-openid', 'class.create', {
    mode: 'single', name: '店主亲授', teacherId: s.teacher._id, date: '2024-06-03', startTime: '18:00', duration: 60, requestId: reqId(),
  });
});

test('R2. 店主将已注册学员授予教师角色，学员身份保留', async () => {
  const env = await setup();
  await env.ok('owner-openid', 'staff.grantRole', { userId: env.uid('student-openid'), role: 'teacher' });
  const s = await env.ok('student-openid', 'auth.login');
  assert.ok(s.roles.includes('teacher') && s.roles.includes('student'));
  assert.ok(s.student && s.teacher);
});

test('R3. 撤销教师角色保留历史课程', async () => {
  const env = await setup();
  const c = await env.createClass();
  await env.ok('owner-openid', 'staff.revokeRole', { userId: env.uid('teacher-openid'), role: 'teacher' });
  const s = await env.ok('teacher-openid', 'auth.login');
  assert.ok(!s.roles.includes('teacher'));
  const list = await env.ok('owner-openid', 'class.list', { from: '2024-06-01', to: '2024-07-31' });
  assert.ok(list.classes.some((x) => x.seriesId === c.seriesId && x.teacherId === env.teacherId));
  const t = await env.store.get('teachers', env.teacherId);
  assert.ok(t);
});

test('R4. 教师不能授予店主/教师；教师不能改课时；学员不能访问管理接口', async () => {
  const env = await setup();
  const a = await env.call('teacher-openid', 'staff.grantRole', { userId: env.uid('student-openid'), role: 'owner' });
  assert.equal(a.code, 'FORBIDDEN');
  const b = await env.call('teacher-openid', 'staff.grantRole', { userId: env.uid('student-openid'), role: 'teacher' });
  assert.equal(b.code, 'FORBIDDEN');
  const { membershipId } = await env.givePass(env.studentId, 10);
  const t = await env.call('teacher-openid', 'membership.adjustCredits', { membershipId, delta: 5, reason: 'x' });
  assert.equal(t.code, 'FORBIDDEN');
  for (const action of ['staff.list', 'student.search', 'settings.update', 'staff.grantRole']) {
    const r = await env.call('student-openid', action, {});
    assert.equal(r.ok, false, action);
  }
});

test('R5. 重复授予同一角色不会产生重复', async () => {
  const env = await setup();
  const r = await env.call('owner-openid', 'staff.grantRole', { userId: env.uid('teacher-openid'), role: 'teacher' });
  const s = await env.ok('teacher-openid', 'auth.login');
  assert.equal(s.roles.filter((x) => x === 'teacher').length, 1);
  if (r.ok) assert.equal(s.teacher._id, env.teacherId);
  const teachers = await env.store.find('teachers', {});
  assert.equal(teachers.filter((x) => x.userId === env.uid('teacher-openid')).length, 1);
});

test('R6. 店主初始化后，再次初始化被拒绝；前端不可调用', async () => {
  const env = await setup();
  await env.registerStudent('x-openid', { name: '路人' });
  const again = await env.system('system.bootstrapOwner', { userId: env.uid('x-openid') });
  assert.equal(again.ok, false);
  const front = await env.call('x-openid', 'system.bootstrapOwner', { userId: env.uid('x-openid') });
  assert.equal(front.ok, false);
  assert.ok(!(await env.ok('x-openid', 'auth.login')).roles.includes('owner'));
});

test('R7. 生产环境拒绝开发者身份模拟', async () => {
  const env = await setup();
  const r = await env.call('student-openid', 'auth.login', {}, { devAs: 'owner' });
  assert.equal(r.ok, false);
  const d = await env.call('student-openid', 'dev.identities', {});
  assert.equal(d.ok, false);
  const o = await env.call('student-openid', 'auth.login', {}, { role: 'owner' });
  assert.equal(o.ok, false);
});

test('R8. 新用户注册自动获得学员；教师可同时为学员', async () => {
  const env = await setup();
  const s = await env.ok('student-openid', 'auth.login');
  assert.deepEqual(s.roles, ['student']);
  await env.ok('owner-openid', 'staff.grantRole', { userId: env.uid('student-openid'), role: 'teacher' });
  assert.deepEqual((await env.ok('student-openid', 'auth.login')).roles, ['teacher', 'student']);
});

test('R9. 旧 ADMIN 账号：不再有任何权限；迁移保留账号与数据，无法归属者列入清单而不自动授权', async () => {
  const env = await setup();
  const ts = Date.now();
  await env.store.create('users', { _id: env.uid('legacy-admin'), openid: 'legacy-admin', roles: ['admin'], role: 'admin', status: 'active', name: '老管理员', wxid: '', privacyAgreedVersion: 'x', createdAt: ts, updatedAt: ts });
  await env.store.create('users', { _id: env.uid('legacy-admin2'), openid: 'legacy-admin2', role: 'admin', status: 'active', name: '旧版管理员', wxid: '', privacyAgreedVersion: 'x', createdAt: ts, updatedAt: ts });
  await env.store.update('users', env.uid('owner-openid'), { roles: ['owner', 'admin'], role: 'owner' });
  await env.store.set('rolePermissions', 'admin', { permissions: ['class.manage'] });
  const before = await env.ok('legacy-admin', 'auth.login');
  assert.deepEqual(before.roles, []);
  const denied = await env.call('legacy-admin', 'student.search', { keyword: '小' });
  assert.equal(denied.ok, false);

  const m = await env.system('system.migrate', {});
  assert.ok(m.ok, m.message);
  assert.deepEqual(m.data.adminMigration.mergedIntoOwner.map((x) => x.userId), [env.uid('owner-openid')]);
  assert.deepEqual(m.data.adminMigration.pending.map((x) => x.userId).sort(), [env.uid('legacy-admin'), env.uid('legacy-admin2')].sort());
  const u = await env.store.get('users', env.uid('legacy-admin'));
  assert.deepEqual(u.roles, []);
  assert.equal(u.status, 'active');
  assert.deepEqual(u.legacyRoles, ['admin']);
  assert.deepEqual((await env.store.get('users', env.uid('owner-openid'))).roles, ['owner']);
  assert.equal(await env.store.get('rolePermissions', 'admin'), null);

  const list = await env.ok('owner-openid', 'staff.legacyAdmins');
  assert.equal(list.length, 2);
  const t = await env.call('teacher-openid', 'staff.legacyAdmins');
  assert.equal(t.code, 'FORBIDDEN');
  await env.ok('owner-openid', 'staff.resolveLegacyAdmin', { userId: env.uid('legacy-admin') });
  assert.equal((await env.ok('owner-openid', 'staff.legacyAdmins')).length, 1);
  const again = await env.system('system.migrate', {});
  assert.equal(again.data.adminMigration.pending.length, 0);
});
