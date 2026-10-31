'use strict';
/**
 * 存储接口（CloudBase 与内存实现共用）：
 *   get(coll, id) → doc | null
 *   find(coll, where, { orderBy: [[field, 'asc'|'desc']], limit, skip }) → doc[]
 *   count(coll, where) → number
 *   create(coll, doc) → id（doc._id 存在则使用之；重复主键抛 DUPLICATE）
 *   set(coll, id, doc) / update(coll, id, patch) / remove(coll, id)
 *   transaction(fn(tx)) — tx 支持 get/create/set/update/remove，原子提交
 *
 * where 语法：{ field: value | { $in, $nin, $gt, $gte, $lt, $lte, $ne, $contains, $regex } , $or: [where...] }
 */
const MAX_PAGE = 1000;

function matchValue(actual, cond) {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.keys(cond).every((op) => {
      const v = cond[op];
      switch (op) {
        case '$in': return v.includes(actual);
        case '$nin': return !v.includes(actual);
        case '$gt': return actual !== undefined && actual > v;
        case '$gte': return actual !== undefined && actual >= v;
        case '$lt': return actual !== undefined && actual < v;
        case '$lte': return actual !== undefined && actual <= v;
        case '$ne': return actual !== v;
        case '$contains': return Array.isArray(actual) && actual.includes(v);
        case '$regex': return typeof actual === 'string' && new RegExp(v, 'i').test(actual);
        default: throw new Error(`unsupported operator ${op}`);
      }
    });
  }
  return actual === cond;
}

function getPath(doc, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
}

function matches(doc, where) {
  if (!where) return true;
  return Object.keys(where).every((k) => {
    if (k === '$or') return where.$or.some((w) => matches(doc, w));
    return matchValue(getPath(doc, k), where[k]);
  });
}

module.exports = { matches, getPath, MAX_PAGE };
