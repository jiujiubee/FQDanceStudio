'use strict';
/**
 * 上课名单（可选）。课程级名单优先于排课批次名单。
 * 未配置名单时返回 null —— 调用方不得据此把全部学员视为缺勤。
 */
async function resolveRoster(store, cls) {
  let roster = await store.get('attendanceRosters', `class_${cls._id}`);
  if (!roster && cls.seriesId) roster = await store.get('attendanceRosters', `series_${cls.seriesId}`);
  if (!roster) return null;
  const set = new Set(roster.studentIds || []);
  for (const g of roster.groups || []) {
    const members = await store.find('students', { groups: { $contains: g }, status: 'active' });
    members.forEach((s) => set.add(s._id));
  }
  if (!set.size) return null;
  return { rosterId: roster._id, studentIds: [...set], groups: roster.groups || [], explicitIds: roster.studentIds || [] };
}

module.exports = { resolveRoster };
