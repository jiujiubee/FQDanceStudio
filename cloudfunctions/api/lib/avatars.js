'use strict';
/**
 * 学员头像解析：优先 Student Profile 头像，其次关联 User 头像；
 * cloud:// fileID 由云函数换成 HTTPS 临时地址（学员之间无云存储读权限）。
 * 均无有效头像时返回空串，由前端显示本地默认头像。
 */

const isCloud = (f) => typeof f === 'string' && f.indexOf('cloud://') === 0;
const isValid = (f) => typeof f === 'string' && (isCloud(f) || /^https?:\/\//i.test(f));

/** students: 学员档案数组；返回 Map<studentId, avatarUrl> */
async function studentAvatarUrls(ctx, students) {
  const userIds = [...new Set(students.map((s) => s && s.userId).filter(Boolean))];
  const users = userIds.length ? await ctx.store.find('users', { _id: { $in: userIds } }) : [];
  const uMap = new Map(users.map((u) => [u._id, u]));
  const source = new Map();
  for (const s of students) {
    if (!s) continue;
    const u = uMap.get(s.userId);
    const f = [s.avatar, u && u.avatar].find(isValid) || '';
    source.set(s._id, f);
  }
  const cloudIds = [...new Set([...source.values()].filter(isCloud))];
  let urlMap = {};
  if (cloudIds.length && ctx.providers && ctx.providers.getTempFileURLs) {
    try { urlMap = (await ctx.providers.getTempFileURLs(cloudIds)) || {}; } catch (e) { console.error('[avatars] getTempFileURL failed', e && e.message); }
  }
  const out = new Map();
  for (const [id, f] of source) out.set(id, isCloud(f) ? urlMap[f] || '' : f);
  return out;
}

module.exports = { studentAvatarUrls };
