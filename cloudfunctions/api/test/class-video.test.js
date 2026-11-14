'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, reqId } = require('./helpers');

const vid = (env, openid, name) => `cloud://env-1.abc/class-videos/${env.uid(openid)}/${name}.mp4`;

test('V1. 批量排课复用同一视频；学生端获得播放地址；无视频课程不返回地址', async () => {
  const env = await setup();
  const fileId = vid(env, 'owner-openid', 'a1');
  const r = await env.ok('owner-openid', 'class.create', {
    mode: 'weekly', name: '爵士', teacherId: env.teacherId, startTime: '18:00', duration: 60,
    startDate: '2024-06-03', endDate: '2024-06-16', weekdays: [1, 3], requestId: reqId(), videoFileId: fileId,
  });
  assert.equal(r.created, 4);
  for (const id of r.classIds) assert.equal((await env.store.get('classes', id)).videoFileId, fileId);
  const d = await env.ok('student-openid', 'schedule.classDetail', { classId: r.classIds[1] });
  assert.ok(d.class.videoUrl.startsWith('https://'));
  const plain = await env.createClass({ startTime: '20:00' });
  const d2 = await env.ok('student-openid', 'schedule.classDetail', { classId: plain.classes[0]._id });
  assert.equal(d2.class.videoUrl, '');
  const g = await env.ok('owner-openid', 'class.get', { classId: r.classIds[0] });
  assert.equal(g.class.videoFileId, fileId);
  assert.ok(g.class.videoUrl);
});

test('V2. 更换/删除单节视频只影响该节；共享文件仍被引用时不删除', async () => {
  const env = await setup();
  const shared = vid(env, 'owner-openid', 'shared');
  const r = await env.ok('owner-openid', 'class.create', {
    mode: 'multi', name: '爵士', teacherId: env.teacherId, startTime: '18:00', duration: 60,
    dates: ['2024-06-04', '2024-06-05'], requestId: reqId(), videoFileId: shared,
  });
  const [a, b] = r.classIds;
  const repl = vid(env, 'owner-openid', 'new');
  await env.ok('owner-openid', 'class.update', { classId: a, videoFileId: repl });
  assert.equal((await env.store.get('classes', a)).videoFileId, repl);
  assert.equal((await env.store.get('classes', b)).videoFileId, shared);
  assert.deepEqual(env.deletedFiles, [], '共享视频仍被另一节课使用，不删除');
  await env.ok('owner-openid', 'class.update', { classId: b, videoFileId: '' });
  assert.equal((await env.store.get('classes', b)).videoFileId, '');
  assert.deepEqual(env.deletedFiles, [shared], '最后一个引用移除后删除文件');
  const d = await env.ok('student-openid', 'schedule.classDetail', { classId: b });
  assert.equal(d.class.videoUrl, '');
});

test('V3. 拒绝非法或他人目录的视频文件标识；教师无排课权限不能改视频', async () => {
  const env = await setup();
  const c = await env.createClass();
  const id = c.classes[0]._id;
  for (const bad of ['/tmp/local.mp4', 'wxfile://tmp_abc.mp4', vid(env, 'teacher-openid', 'x'), `cloud://env-1.abc/class-videos/${env.uid('owner-openid')}/a.exe`]) {
    const res = await env.call('owner-openid', 'class.update', { classId: id, videoFileId: bad });
    assert.equal(res.ok, false, bad);
  }
  const t = await env.call('teacher-openid', 'class.update', { classId: id, videoFileId: vid(env, 'teacher-openid', 'x') });
  assert.equal(t.code, 'FORBIDDEN');
});
