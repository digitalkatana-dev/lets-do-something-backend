'use strict';
const { buildContext, evalCondition, resolveAttr, listMatches, INDETERMINATE } = require('./engine');

/**
 * Turn policies into a MongoDB filter for list endpoints ("partial evaluation").
 * Subject/env conditions are decided now; resource.* conditions become Mongo clauses.
 *
 * Returns { mode, filter }:
 *   mode 'none'   -> nothing is visible (respond 403)
 *   mode 'all'    -> filter is {} (everything visible)
 *   mode 'filter' -> pass `filter` to your query (use scope() to combine safely)
 *
 * The result is equivalent to calling evaluate() on each document (covered by tests).
 */

class FilterUnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FilterUnsupportedError';
  }
}

const NEVER = Symbol('never');
const ALWAYS = Symbol('always');

function clauseFor(cond, expected, idField) {
  let field = cond.attr.slice('resource.'.length);
  if (field === 'id') field = idField;
  switch (cond.op) {
    case 'eq': return { [field]: expected };
    case 'ne': return { [field]: { $ne: expected } };
    case 'in': return { [field]: { $in: [].concat(expected) } };
    case 'nin': return { [field]: { $nin: [].concat(expected) } };
    case 'gt': return { [field]: { $gt: expected } };
    case 'gte': return { [field]: { $gte: expected } };
    case 'lt': return { [field]: { $lt: expected } };
    case 'lte': return { [field]: { $lte: expected } };
    case 'exists': return expected ? { [field]: { $ne: null } } : { [field]: null };
    case 'contains': return { [field]: { $elemMatch: { $eq: expected } } };
    default: throw new FilterUnsupportedError(`Operator "${cond.op}" is not supported in filters`);
  }
}

/** Partially evaluate one policy: NEVER, ALWAYS, or a Mongo clause. */
function partial(policy, ctx, idField) {
  const clauses = [];
  for (const cond of policy.conditions) {
    const root = cond.attr.split('.')[0];
    if (cond.valueFrom !== undefined && cond.valueFrom.startsWith('resource.') && root === 'resource') {
      throw new FilterUnsupportedError(
        `Policy "${policy.id}" compares two resource attributes; it can't be turned into a query filter. Use check() per document instead.`
      );
    }
    if (cond.valueFrom !== undefined && cond.valueFrom.startsWith('resource.') && root !== 'resource') {
      throw new FilterUnsupportedError(
        `Policy "${policy.id}" compares ${cond.attr} to a resource attribute; use check() per document instead.`
      );
    }
    if (root !== 'resource') {
      let pass = evalCondition(cond, ctx).result;
      if (pass === INDETERMINATE) pass = policy.effect === 'deny';
      if (!pass) return NEVER;
      continue;
    }
    let expected;
    if (cond.op === 'exists') expected = cond.value === undefined ? true : cond.value;
    else if (cond.valueFrom !== undefined) {
      expected = resolveAttr(ctx, cond.valueFrom);
      if (expected === undefined || expected === null) {
        if (policy.effect === 'deny') continue; // indeterminate counts as true for deny
        return NEVER;
      }
    } else expected = cond.value;
    clauses.push(clauseFor(cond, expected, idField));
  }
  if (clauses.length === 0) return ALWAYS;
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function buildFilter(policies, { subject, action, resourceType, env }, { idField = '_id' } = {}) {
  const ctx = buildContext({ subject, resource: undefined, env });
  const allowClauses = [];
  const denyClauses = [];
  let allowAll = false;

  for (const p of policies) {
    if (p.enabled === false) continue;
    if (!listMatches(p.actions, action) || !listMatches(p.resources, resourceType)) continue;
    const r = partial(p, ctx, idField);
    if (r === NEVER) continue;
    if (p.effect === 'deny') {
      if (r === ALWAYS) return { mode: 'none', filter: null };
      denyClauses.push(r);
    } else if (r === ALWAYS) allowAll = true;
    else allowClauses.push(r);
  }

  if (!allowAll && allowClauses.length === 0) return { mode: 'none', filter: null };

  const parts = [];
  if (!allowAll) parts.push(allowClauses.length === 1 ? allowClauses[0] : { $or: allowClauses });
  if (denyClauses.length) parts.push({ $nor: denyClauses });

  if (parts.length === 0) return { mode: 'all', filter: {} };
  return { mode: 'filter', filter: parts.length === 1 ? parts[0] : { $and: parts } };
}

/** Safely AND the permission filter with the caller's own query. */
function scope(filter, query) {
  const hasQuery = query && Object.keys(query).length > 0;
  const hasFilter = filter && Object.keys(filter).length > 0;
  if (hasQuery && hasFilter) return { $and: [filter, query] };
  if (hasFilter) return filter;
  return query || {};
}

module.exports = { buildFilter, scope, FilterUnsupportedError };
