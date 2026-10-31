'use strict';
/**
 * CloudBase 云数据库存储实现（wx-server-sdk）。
 */
const { AppError } = require('../lib/errors');
const { MAX_PAGE } = require('./query');

function createCloudStore(cloud) {
  const db = cloud.database();
  const _ = db.command;

  function translateCond(cond) {
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const parts = Object.keys(cond).map((op) => {
        const v = cond[op];
        switch (op) {
          case '$in': return _.in(v);
          case '$nin': return _.nin(v);
          case '$gt': return _.gt(v);
          case '$gte': return _.gte(v);
          case '$lt': return _.lt(v);
          case '$lte': return _.lte(v);
          case '$ne': return _.neq(v);
          case '$contains': return v;
          case '$regex': return db.RegExp({ regexp: v, options: 'i' });
          default: throw new Error(`unsupported operator ${op}`);
        }
      });
      return parts.length === 1 ? parts[0] : _.and(parts);
    }
    return cond;
  }
  function translate(where) {
    if (!where) return {};
    const out = {};
    const ors = [];
    for (const k of Object.keys(where)) {
      if (k === '$or') ors.push(_.or(where.$or.map(translate)));
      else out[k] = translateCond(where[k]);
    }
    if (ors.length) return _.and([out, ...ors]);
    return out;
  }
  const isDup = (e) => /duplicate|E11000|-502001/i.test(String((e && (e.errMsg || e.message)) || ''));
  const isMissing = (e) => /not exist|cannot find|-502004|does not exist/i.test(String((e && (e.errMsg || e.message)) || ''));
  const strip = (doc) => {
    const d = { ...doc };
    delete d._id;
    delete d._openid;
    return d;
  };

  return {
    async get(c, id) {
      try {
        const r = await db.collection(c).doc(id).get();
        return r.data || null;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async find(c, where, opts) {
      opts = opts || {};
      const want = opts.limit || MAX_PAGE * 5;
      const out = [];
      let skip = opts.skip || 0;
      while (out.length < want) {
        let q = db.collection(c).where(translate(where));
        for (const [f, dir] of opts.orderBy || []) q = q.orderBy(f, dir);
        const n = Math.min(MAX_PAGE, want - out.length);
        const r = await q.skip(skip).limit(n).get();
        out.push(...r.data);
        if (r.data.length < n) break;
        skip += r.data.length;
      }
      return out;
    },
    async count(c, where) {
      const r = await db.collection(c).where(translate(where)).count();
      return r.total;
    },
    async create(c, doc) {
      try {
        const data = doc._id ? { ...strip(doc), _id: doc._id } : strip(doc);
        const r = await db.collection(c).add({ data });
        return r._id;
      } catch (e) {
        if (isDup(e)) throw new AppError('DUPLICATE', 'duplicate key', 409);
        throw e;
      }
    },
    async set(c, id, doc) {
      await db.collection(c).doc(id).set({ data: strip(doc) });
    },
    async update(c, id, patch) {
      await db.collection(c).doc(id).update({ data: strip(patch) });
    },
    async remove(c, id) {
      await db.collection(c).doc(id).remove();
    },
    async transaction(fn) {
      return db.runTransaction(async (t) => {
        const tx = {
          async get(c, id) {
            try {
              const r = await t.collection(c).doc(id).get();
              return r.data || null;
            } catch (e) {
              if (isMissing(e)) return null;
              throw e;
            }
          },
          async create(c, doc) {
            if (doc._id) {
              const exists = await tx.get(c, doc._id);
              if (exists) throw new AppError('DUPLICATE', 'duplicate key', 409);
              await t.collection(c).doc(doc._id).set({ data: strip(doc) });
              return doc._id;
            }
            const r = await t.collection(c).add({ data: strip(doc) });
            return r._id;
          },
          async set(c, id, doc) {
            await t.collection(c).doc(id).set({ data: strip(doc) });
          },
          async update(c, id, patch) {
            await t.collection(c).doc(id).update({ data: strip(patch) });
          },
          async remove(c, id) {
            await t.collection(c).doc(id).remove();
          },
        };
        return fn(tx);
      }, 3);
    },
  };
}

module.exports = { createCloudStore };
