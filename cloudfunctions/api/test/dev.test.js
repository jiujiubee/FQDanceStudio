'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('D1. 开发环境：生成测试数据并切换模拟身份', async () => {
  const env = await setup({ env: { APP_ENV: 'development' } });
  const seeded = await env.ok('dev-openid', 'dev.seed', {});
  assert.ok(seeded.accounts.includes('owner'));
  const asOwner = await env.ok('dev-openid', 'auth.login', {}, { devAs: 'owner' });
  assert.deepEqual([...asOwner.roles].sort(), ['owner', 'teacher']);
  const asStudent = await env.ok('dev-openid', 'auth.login', {}, { devAs: 'student' });
  assert.deepEqual(asStudent.roles, ['student']);
  const blocked = await env.call('dev-openid', 'staff.list', {}, { devAs: 'student' });
  assert.equal(blocked.code, 'FORBIDDEN');
  const ids = await env.ok('dev-openid', 'dev.identities', {}, { devAs: 'teacher' });
  assert.equal(ids.current, 'teacher');
});
