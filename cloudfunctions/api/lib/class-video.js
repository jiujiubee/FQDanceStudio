'use strict';
/** 课程视频：由云函数以管理员身份换取临时播放地址，学生端无需云存储读权限 */

async function videoUrl(ctx, fileId) {
  if (!fileId || !ctx.providers || !ctx.providers.getTempFileURLs) return '';
  try {
    const map = await ctx.providers.getTempFileURLs([fileId]);
    return (map && map[fileId]) || '';
  } catch (e) {
    console.error('[class.video] getTempFileURL failed', fileId, e && e.message);
    return '';
  }
}

module.exports = { videoUrl };
