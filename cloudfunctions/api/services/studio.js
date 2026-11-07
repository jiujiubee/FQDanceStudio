'use strict';
/**
 * 学生端首页：工作室海报、简介、地址、导师团队；店主维护首页资料与导师资料。
 * 资料存于 systemSettings.global.studio 与 teachers 集合（真实字段，无硬编码占位数据）。
 */
const time = require('../lib/time');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const { P } = require('../lib/permissions');

const FILE_RE = /^cloud:\/\/[^/]+\/avatars\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/i;

/** 只接受操作者本人目录（或资料原有）的云存储文件 */
function fileId(ctx, val, name, allowed) {
  const s = v.str(val, name, { max: 300 });
  if (!FILE_RE.test(s)) throw E.invalid(`${name}文件无效`);
  if (!s.includes(`/avatars/${ctx.user._id}/`) && !(allowed || []).includes(s)) throw E.forbidden(`${name}文件无效`);
  return s;
}

function strList(val, name, max, itemMax) {
  if (val === undefined || val === null) return [];
  if (!Array.isArray(val) || val.length > max) throw E.invalid(`${name}格式错误`);
  return val.map((x) => v.str(x, name, { max: itemMax })).filter(Boolean);
}

/** 经纬度：可空；若填写必须是有效数字 */
function coord(val, name, limit) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || Math.abs(n) > limit) throw E.invalid(`${name}格式错误`);
  return n;
}

function teacherCard(t) {
  return { _id: t._id, name: t.name, avatar: t.avatar || '', intro: t.intro || t.bio || '', styles: t.styles || [] };
}

function teacherDetail(t) {
  return {
    ...teacherCard(t), bio: t.bio || '', experience: t.experience || '', photos: t.photos || [], sort: t.sort === undefined ? 100 : t.sort,
  };
}

async function activeTeachers(store) {
  const list = await store.find('teachers', { status: 'active' });
  return list.sort((a, b) => (a.sort === undefined ? 100 : a.sort) - (b.sort === undefined ? 100 : b.sort) || (a.createdAt || 0) - (b.createdAt || 0));
}

module.exports = {
  /** 学生首页数据（任何已注册用户可见） */
  async 'home.get'(ctx) {
    if (!ctx.registered) throw E.notRegistered();
    const s = ctx.settings.studio || {};
    return {
      studioName: ctx.settings.studioName,
      posters: s.posters || [],
      intro: s.intro || '',
      features: s.features || [],
      about: s.about || '',
      address: s.address || '',
      phone: s.phone || '',
      logo: s.logo || '',
      businessHours: s.businessHours || '',
      latitude: typeof s.latitude === 'number' ? s.latitude : null,
      longitude: typeof s.longitude === 'number' ? s.longitude : null,
      teachers: (await activeTeachers(ctx.store)).map(teacherCard),
    };
  },

  async 'teacher.publicGet'(ctx, data) {
    if (!ctx.registered) throw E.notRegistered();
    const t = await ctx.store.get('teachers', v.id(data.teacherId, '导师'));
    if (!t || t.status !== 'active') throw E.notFound('导师');
    return teacherDetail(t);
  },

  /** 店主更新首页资料 */
  async 'studio.update'(ctx, data) {
    ctx.require(P.SETTINGS_MANAGE);
    const before = await ctx.store.get('systemSettings', 'global');
    const cur = ctx.settings.studio || {};
    const posters = strList(data.posters, '海报', 6, 300).map((p) => fileId(ctx, p, '海报', cur.posters));
    const studio = {
      posters,
      intro: v.str(data.intro, '简介', { optional: true, max: 500 }),
      features: strList(data.features, '特色课程', 12, 30),
      about: v.str(data.about, '相关介绍', { optional: true, max: 1000 }),
      address: v.str(data.address, '地址', { optional: true, max: 120 }),
      phone: v.str(data.phone, '联系电话', { optional: true, max: 20 }),
      logo: data.logo ? fileId(ctx, data.logo, 'Logo', [cur.logo]) : '',
      businessHours: v.str(data.businessHours, '营业时间', { optional: true, max: 60 }),
      latitude: coord(data.latitude, '纬度', 90),
      longitude: coord(data.longitude, '经度', 180),
    };
    const patch = { studio };
    if (data.studioName !== undefined) patch.studioName = v.str(data.studioName, '工作室名称', { max: 40 });
    await ctx.store.set('systemSettings', 'global', { ...(before || {}), ...patch, _id: 'global', updatedBy: ctx.user._id, updatedAt: time.now() });
    await ctx.audit('studio.update', 'systemSettings', 'global', before ? before.studio || null : null, studio, '');
    return { updated: true };
  },

  /** 店主：导师列表（含资料编辑所需字段） */
  async 'teacher.manageList'(ctx) {
    ctx.require(P.TEACHER_MANAGE);
    return (await activeTeachers(ctx.store)).map(teacherDetail);
  },

  /** 店主编辑导师资料（头像、简介、擅长舞种、教学经历、照片） */
  async 'teacher.updateProfile'(ctx, data) {
    ctx.require(P.TEACHER_MANAGE);
    const id = v.id(data.teacherId, '导师');
    const t = await ctx.store.get('teachers', id);
    if (!t || t.status !== 'active') throw E.notFound('导师');
    const patch = { updatedAt: time.now() };
    if (data.name !== undefined) patch.name = v.str(data.name, '姓名', { max: 30 });
    if (data.avatar !== undefined) patch.avatar = data.avatar ? fileId(ctx, data.avatar, '头像', [t.avatar]) : '';
    if (data.intro !== undefined) patch.intro = v.str(data.intro, '简短介绍', { optional: true, max: 60 });
    if (data.bio !== undefined) patch.bio = v.str(data.bio, '个人简介', { optional: true, max: 500 });
    if (data.experience !== undefined) patch.experience = v.str(data.experience, '教学经历', { optional: true, max: 1000 });
    if (data.styles !== undefined) patch.styles = strList(data.styles, '擅长舞种', 10, 20);
    if (data.photos !== undefined) patch.photos = strList(data.photos, '照片', 9, 300).map((p) => fileId(ctx, p, '照片', t.photos));
    if (data.sort !== undefined) patch.sort = v.int(data.sort, '排序', { min: 0, max: 999 });
    await ctx.store.update('teachers', id, patch);
    if (patch.name) {
      await ctx.store.update('users', t.userId, { name: patch.name, updatedAt: patch.updatedAt }).catch(() => null);
    }
    await ctx.audit('teacher.profile', 'teacher', id, null, patch, '');
    return { updated: true };
  },
};
