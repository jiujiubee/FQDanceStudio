'use strict';
/**
 * 学员头像解析：优先 Student Profile 头像，其次关联 User 头像；
 * cloud:// fileID 由云函数换成 HTTPS 临时地址（学员之间无云存储读权限）。
 * 均无有效头像时返回空串，由前端显示本地默认头像。
 */

const isCloud = (f) => typeof f === 'string' && f.indexOf('cloud://') === 0;
const isValid = (f) => typeof f === 'string' && (isCloud(f) || /^https?:\/\//i.test(f));

/** source: Map<key, fileID|url> → Map<key, 可访问 URL>（cloud:// 统一换成临时 HTTPS 地址，失败为空串） */
async function toUrls(ctx, source) {
  const cloudIds = [...new Set([...source.values()].filter(isCloud))];
  let urlMap = {};
  if (cloudIds.length && ctx.providers && ctx.providers.getTempFileURLs) {
    try { urlMap = (await ctx.providers.getTempFileURLs(cloudIds)) || {}; } catch (e) { console.error('[avatars] getTempFileURL failed', e && e.message); }
  }
  const out = new Map();
  for (const [id, f] of source) out.set(id, isCloud(f) ? urlMap[f] || '' : f || '');
  return out;
}

/** 关联 User 的头像：users.avatar，其次该用户本人的学员档案头像 */
async function userAvatarFiles(ctx, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const users = ids.length ? await ctx.store.find('users', { _id: { $in: ids } }) : [];
  const sids = [...new Set(users.map((u) => u.studentId).filter(Boolean))];
  const studs = sids.length ? await ctx.store.find('students', { _id: { $in: sids } }) : [];
  const sMap = new Map(studs.map((s) => [s._id, s]));
  const out = new Map();
  for (const u of users) {
    const s = sMap.get(u.studentId);
    out.set(u._id, [u.avatar, s && s.status !== 'deleted' ? s.avatar : ''].find(isValid) || '');
  }
  return out;
}

/** students: 学员档案数组；返回 Map<studentId, avatarUrl> */
async function studentAvatarUrls(ctx, students) {
  const list = students.filter(Boolean);
  const userIds = [...new Set(list.map((s) => s.userId).filter(Boolean))];
  const users = userIds.length ? await ctx.store.find('users', { _id: { $in: userIds } }) : [];
  const uMap = new Map(users.map((u) => [u._id, u]));
  const source = new Map();
  for (const s of list) {
    const u = uMap.get(s.userId);
    source.set(s._id, [s.avatar, u && u.avatar].find(isValid) || '');
  }
  return toUrls(ctx, source);
}

/**
 * 教师头像：优先 Teacher Profile 头像（缩略图优先），其次关联 User 头像。
 * 不依赖角色组合（OWNER + TEACHER 同样适用）。返回 Map<teacherId, avatarUrl>
 */
async function teacherAvatarUrls(ctx, teachers) {
  const list = teachers.filter(Boolean);
  const need = list.filter((t) => !isValid(t.avatarThumb) && !isValid(t.avatar)).map((t) => t.userId);
  const uFiles = await userAvatarFiles(ctx, need);
  const source = new Map();
  for (const t of list) source.set(t._id, [t.avatarThumb, t.avatar, uFiles.get(t.userId)].find(isValid) || '');
  return toUrls(ctx, source);
}

/** 当前登录用户（个人中心）：学员档案头像 → 教师档案头像 → 关联 User 头像 */
async function selfAvatarUrl(ctx) {
  const f = [ctx.student && ctx.student.avatar, ctx.teacher && ctx.teacher.avatar, ctx.user && ctx.user.avatar].find(isValid) || '';
  return (await toUrls(ctx, new Map([['self', f]]))).get('self') || '';
}

module.exports = { studentAvatarUrls, teacherAvatarUrls, selfAvatarUrl };
