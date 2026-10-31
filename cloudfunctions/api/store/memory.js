'use strict';
/**
 * 内存存储：用于单元/集成测试。实现与 CloudBase 相同的语义，
 * 事务采用乐观并发控制（读集版本校验），可真实模拟并发签到冲突。
 */
const { matches, getPath } = require('./query');
const { AppError } = require('../lib/errors');

const tick = () => new Promise((r) => setImmediate(r));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function applyPatch(doc, patch) {
  const out = clone(doc);
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split('.');
    let o = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = clone(v);
  }
  return out;
}

class MemoryStore {
  constructor() {
    this.data = new Map();
    this.versions = new Map();
    this.seq = 0;
  }
  _coll(c) {
    if (!this.data.has(c)) this.data.set(c, new Map());
    return this.data.get(c);
  }
  _key(c, id) {
    return `${c}/${id}`;
  }
  _bump(c, id) {
    const k = this._key(c, id);
    this.versions.set(k, (this.versions.get(k) || 0) + 1);
  }
  _newId() {
    this.seq += 1;
    return `mem${Date.now().toString(36)}${this.seq}`;
  }

  async get(c, id) {
    await tick();
    return clone(this._coll(c).get(id)) || null;
  }
  async find(c, where, opts) {
    await tick();
    let docs = [...this._coll(c).values()].filter((d) => matches(d, where));
    const orderBy = (opts && opts.orderBy) || [];
    if (orderBy.length) {
      docs.sort((a, b) => {
        for (const [f, dir] of orderBy) {
          const x = getPath(a, f);
          const y = getPath(b, f);
          if (x === y) continue;
          const r = x > y ? 1 : -1;
          return dir === 'desc' ? -r : r;
        }
        return 0;
      });
    }
    const skip = (opts && opts.skip) || 0;
    const limit = (opts && opts.limit) || docs.length;
    return clone(docs.slice(skip, skip + limit));
  }
  async count(c, where) {
    return (await this.find(c, where)).length;
  }
  async create(c, doc) {
    await tick();
    const id = doc._id || this._newId();
    if (this._coll(c).has(id)) throw new AppError('DUPLICATE', 'duplicate key', 409);
    this._coll(c).set(id, clone({ ...doc, _id: id }));
    this._bump(c, id);
    return id;
  }
  async set(c, id, doc) {
    await tick();
    this._coll(c).set(id, clone({ ...doc, _id: id }));
    this._bump(c, id);
  }
  async update(c, id, patch) {
    await tick();
    const cur = this._coll(c).get(id);
    if (!cur) throw new AppError('NOT_FOUND', 'document not found', 404);
    this._coll(c).set(id, applyPatch(cur, patch));
    this._bump(c, id);
  }
  async remove(c, id) {
    await tick();
    this._coll(c).delete(id);
    this._bump(c, id);
  }

  async transaction(fn) {
    const reads = new Map();
    const writes = [];
    const local = new Map();
    const self = this;
    const tx = {
      async get(c, id) {
        await tick();
        const k = self._key(c, id);
        if (local.has(k)) return clone(local.get(k));
        if (!reads.has(k)) reads.set(k, self.versions.get(k) || 0);
        return clone(self._coll(c).get(id)) || null;
      },
      async create(c, doc) {
        const id = doc._id || self._newId();
        const k = self._key(c, id);
        if (!reads.has(k) && !local.has(k)) reads.set(k, self.versions.get(k) || 0);
        if ((local.has(k) && local.get(k)) || (!local.has(k) && self._coll(c).has(id))) {
          throw new AppError('DUPLICATE', 'duplicate key', 409);
        }
        const full = { ...clone(doc), _id: id };
        local.set(k, full);
        writes.push(['set', c, id, full]);
        return id;
      },
      async set(c, id, doc) {
        const full = { ...clone(doc), _id: id };
        local.set(self._key(c, id), full);
        writes.push(['set', c, id, full]);
      },
      async update(c, id, patch) {
        const k = self._key(c, id);
        const cur = local.has(k) ? local.get(k) : self._coll(c).get(id);
        if (!cur) throw new AppError('NOT_FOUND', 'document not found', 404);
        const next = applyPatch(cur, patch);
        local.set(k, next);
        writes.push(['set', c, id, next]);
      },
      async remove(c, id) {
        local.set(self._key(c, id), null);
        writes.push(['remove', c, id]);
      },
    };
    const result = await fn(tx);
    await tick();
    // 提交阶段（同步，原子）：校验读集版本
    for (const [k, v] of reads) {
      if ((this.versions.get(k) || 0) !== v) {
        throw new AppError('TX_CONFLICT', 'transaction conflict', 409);
      }
    }
    for (const w of writes) {
      if (w[0] === 'set') this._coll(w[1]).set(w[2], clone(w[3]));
      else this._coll(w[1]).delete(w[2]);
      this._bump(w[1], w[2]);
    }
    return result;
  }
}

module.exports = { MemoryStore };
