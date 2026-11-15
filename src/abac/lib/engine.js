'use strict';
const { isDeepStrictEqual } = require('util');

/**
 * Pure policy decision engine. No I/O.
 *
 * Semantics:
 *  - A policy applies when its action + resource type match and ALL conditions pass.
 *  - Any applicable deny wins. Otherwise any applicable allow permits. Otherwise: deny.
 *  - A condition whose `valueFrom` resolves to nothing (e.g. subject.id is missing) is
 *    "indeterminate": it counts as FALSE for allow policies and TRUE for deny policies,
 *    so missing data can never accidentally grant access.
 */

const INDETERMINATE = 'indeterminate';

function isObjectId(v) {
  return v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID');
}

/** Make values comparable: ObjectId -> hex string, Date -> ISO string. */
function normalizeValue(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (isObjectId(v)) return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** Turn Mongoose documents into plain objects and expose `id` consistently. */
function prepare(obj) {
  if (obj === null || obj === undefined) return undefined;
  const plain = typeof obj.toObject === 'function' ? obj.toObject() : obj;
  if (plain.id === undefined && plain._id !== undefined) return { ...plain, id: plain._id };
  return plain;
}

/**
 * Dot-path lookup. Like MongoDB, a path that runs through an array of objects collects the
 * value from every element: `invitedGuests._id` on [{_id: 'a'}, {_id: 'b'}] yields ['a', 'b'].
 */
function getPath(obj, parts) {
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(parts[i])) {
      const rest = parts.slice(i);
      const values = [];
      for (const el of cur) {
        const v = getPath(el, rest);
        if (v === undefined) continue;
        if (Array.isArray(v)) values.push(...v);
        else values.push(v);
      }
      return values.length ? values : undefined;
    }
    cur = cur[parts[i]];
  }
  return cur;
}

function resolveAttr(ctx, attr) {
  const [root, ...rest] = attr.split('.');
  return normalizeValue(getPath(ctx[root], rest));
}

const same = (a, b) => isDeepStrictEqual(a, b);

function eq(actual, expected) {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(actual)) return actual.some((a) => same(a, expected));
  return same(actual, expected);
}

function inList(actual, list) {
  if (Array.isArray(actual)) return actual.some((a) => list.some((e) => same(a, e)));
  if (actual === undefined || actual === null) return list.some((e) => e === null);
  return list.some((e) => same(actual, e));
}

function comparable(a, b) {
  return (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
}

function applyOp(op, actual, expected) {
  switch (op) {
    case 'eq': return eq(actual, expected);
    case 'ne': return !eq(actual, expected);
    case 'in': return inList(actual, [].concat(expected));
    case 'nin': return !inList(actual, [].concat(expected));
    case 'gt': return comparable(actual, expected) && actual > expected;
    case 'gte': return comparable(actual, expected) && actual >= expected;
    case 'lt': return comparable(actual, expected) && actual < expected;
    case 'lte': return comparable(actual, expected) && actual <= expected;
    case 'exists': return (actual !== undefined && actual !== null) === Boolean(expected);
    case 'contains': return Array.isArray(actual) && actual.some((a) => same(a, expected));
    default: throw new Error(`Unknown operator "${op}"`);
  }
}

/** Resolve the right-hand side of a condition. */
function expectedValue(cond, ctx) {
  if (cond.op === 'exists') return cond.value === undefined ? true : cond.value;
  if (cond.valueFrom !== undefined) return resolveAttr(ctx, cond.valueFrom);
  return cond.value;
}

/** @returns {{ result: boolean|'indeterminate', actual, expected }} */
function evalCondition(cond, ctx) {
  const actual = resolveAttr(ctx, cond.attr);
  const expected = expectedValue(cond, ctx);
  if (cond.valueFrom !== undefined && (expected === undefined || expected === null)) {
    return { result: INDETERMINATE, actual, expected };
  }
  return { result: applyOp(cond.op, actual, expected), actual, expected };
}

const listMatches = (list, value) => list.includes('*') || list.includes(value);

function buildContext({ subject, resource, env }) {
  return { subject: prepare(subject), resource: prepare(resource), env: env || {} };
}

/**
 * @param {object[]} policies normalized policies
 * @param {{subject, action, resourceType, resource?, env?}} request
 * @param {{explain?: boolean}} [opts]
 */
function evaluate(policies, request, { explain = false } = {}) {
  const { action, resourceType } = request;
  const ctx = buildContext(request);
  const allow = [];
  const deny = [];
  const trace = explain ? [] : null;

  for (const p of policies) {
    const step = explain ? { policyId: p.id, effect: p.effect } : null;
    if (p.enabled === false) { if (step) trace.push({ ...step, applies: false, why: 'disabled' }); continue; }
    if (!listMatches(p.actions, action)) { if (step) trace.push({ ...step, applies: false, why: 'action does not match' }); continue; }
    if (!listMatches(p.resources, resourceType)) { if (step) trace.push({ ...step, applies: false, why: 'resource type does not match' }); continue; }

    let applies = true;
    const conditionTrace = [];
    for (const cond of p.conditions) {
      const r = evalCondition(cond, ctx);
      let pass = r.result;
      if (pass === INDETERMINATE) pass = p.effect === 'deny'; // fail closed
      if (explain) conditionTrace.push({ ...cond, actual: r.actual, expected: r.expected, result: r.result, counted: pass });
      if (!pass) { applies = false; if (!explain) break; }
    }
    if (step) trace.push({ ...step, applies, why: applies ? 'matched' : 'a condition failed', conditions: conditionTrace });
    if (applies) (p.effect === 'deny' ? deny : allow).push(p.id);
  }

  let effect;
  let reason;
  if (deny.length) { effect = 'deny'; reason = 'explicit-deny'; }
  else if (allow.length) { effect = 'allow'; reason = 'explicit-allow'; }
  else { effect = 'deny'; reason = 'default-deny'; }

  const decision = { allowed: effect === 'allow', effect, reason, allow, deny };
  if (explain) decision.trace = trace;
  return decision;
}

module.exports = { evaluate, evalCondition, resolveAttr, normalizeValue, prepare, buildContext, listMatches, INDETERMINATE };
