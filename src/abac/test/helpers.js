'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const clone = (v) => JSON.parse(JSON.stringify(v));

/** In-memory stand-ins for the two Mongoose models (only the calls the store makes). */
function fakeModels() {
  const policies = new Map();
  const audit = [];
  let seq = 0;
  const state = { down: false };
  const guard = () => { if (state.down) throw new Error('simulated DB outage'); };

  const Policy = {
    find: () => ({ lean: async () => { guard(); return [...policies.values()].map(clone); } }),
    bulkWrite: async (ops) => {
      guard();
      for (const op of ops) {
        if (op.replaceOne) policies.set(op.replaceOne.filter.policyId, { _id: `p${++seq}`, ...clone(op.replaceOne.replacement) });
        if (op.deleteMany) for (const id of op.deleteMany.filter.policyId.$in) policies.delete(id);
      }
    },
  };
  const Audit = {
    insertMany: async (entries) => {
      guard();
      for (const e of entries) audit.push({ _id: `a${String(++seq).padStart(6, '0')}`, ...clone(e) });
    },
    find: (q = {}) => {
      let rows = audit.filter((r) => (!q.policyId || r.policyId === q.policyId) && (!q._id || r._id < q._id.$lt));
      const chain = {
        sort: () => { rows = [...rows].reverse(); return chain; },
        limit: (n) => { rows = rows.slice(0, n); return chain; },
        lean: async () => rows,
      };
      return chain;
    },
  };
  return { Policy, Audit, policies, audit, state };
}

function tmpPolicyFile(doc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abac-test-'));
  const file = path.join(dir, 'policies.json');
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

const quietLogger = { error() {}, warn() {}, log() {}, info() {} };

/** Minimal evaluator for the subset of Mongo query syntax that filter.js emits. */
function mongoMatch(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return cond.every((f) => mongoMatch(doc, f));
    if (key === '$or') return cond.some((f) => mongoMatch(doc, f));
    if (key === '$nor') return !cond.some((f) => mongoMatch(doc, f));
    return matchField(getMongoPath(doc, key.split('.')), cond);
  });
}
// MongoDB multikey semantics: a path through an array of objects yields every element's value.
function getMongoPath(cur, parts) {
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(parts[i])) {
      const vals = cur.flatMap((el) => {
        const v = getMongoPath(el, parts.slice(i));
        return v === undefined ? [] : [].concat(v);
      });
      return vals.length ? vals : undefined;
    }
    cur = cur[parts[i]];
  }
  return cur;
}
function eqMongo(val, x) {
  if (x === null) return val === null || val === undefined;
  if (Array.isArray(val)) return val.some((v) => isDeepStrictEqual(v, x)) || isDeepStrictEqual(val, x);
  return isDeepStrictEqual(val, x);
}
function cmp(val, arg, fn) {
  const test = (v) => typeof v === typeof arg && (typeof v === 'number' || typeof v === 'string') && fn(v, arg);
  return Array.isArray(val) ? val.some(test) : test(val);
}
function matchField(val, cond) {
  const isOps = cond && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'));
  if (!isOps) return eqMongo(val, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$ne': return !eqMongo(val, arg);
      case '$in': return arg.some((a) => eqMongo(val, a));
      case '$nin': return !arg.some((a) => eqMongo(val, a));
      case '$gt': return cmp(val, arg, (a, b) => a > b);
      case '$gte': return cmp(val, arg, (a, b) => a >= b);
      case '$lt': return cmp(val, arg, (a, b) => a < b);
      case '$lte': return cmp(val, arg, (a, b) => a <= b);
      case '$exists': return (val !== undefined) === arg;
      case '$elemMatch': return Array.isArray(val) && val.some((v) => isDeepStrictEqual(v, arg.$eq));
      default: throw new Error(`test matcher: unsupported ${op}`);
    }
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function once(emitter, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), ms);
    emitter.once(event, (v) => { clearTimeout(t); resolve(v); });
  });
}

module.exports = { fakeModels, tmpPolicyFile, quietLogger, mongoMatch, clone, wait, once };
