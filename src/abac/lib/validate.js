'use strict';

const DEFAULT_ACTIONS = ['read', 'create', 'update', 'delete'];
const OPERATORS = ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'exists', 'contains'];
const ATTR_RE = /^(subject|resource|env)(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const POLICY_KEYS = ['id', 'description', 'effect', 'enabled', 'actions', 'resources', 'conditions'];
const CONDITION_KEYS = ['attr', 'op', 'value', 'valueFrom'];

class PolicyValidationError extends Error {
  constructor(errors) {
    super(`Invalid policies:\n - ${errors.join('\n - ')}`);
    this.name = 'PolicyValidationError';
    this.errors = errors;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validateCondition(c, where, errors, { allowValueFromResource = true } = {}) {
  if (!isPlainObject(c)) return errors.push(`${where}: condition must be an object`);
  for (const k of Object.keys(c)) {
    if (!CONDITION_KEYS.includes(k)) errors.push(`${where}: unknown condition key "${k}"`);
  }
  if (typeof c.attr !== 'string' || !ATTR_RE.test(c.attr)) {
    errors.push(`${where}: "attr" must look like subject.x, resource.x or env.x (got ${JSON.stringify(c.attr)})`);
  }
  if (!OPERATORS.includes(c.op)) {
    errors.push(`${where}: "op" must be one of ${OPERATORS.join(', ')} (got ${JSON.stringify(c.op)})`);
    return;
  }
  const hasValue = Object.prototype.hasOwnProperty.call(c, 'value');
  const hasFrom = Object.prototype.hasOwnProperty.call(c, 'valueFrom');
  if (c.op === 'exists') {
    if (hasFrom) errors.push(`${where}: "exists" takes "value" (boolean), not "valueFrom"`);
    if (hasValue && typeof c.value !== 'boolean') errors.push(`${where}: "exists" value must be true or false`);
    return;
  }
  if (hasValue === hasFrom) {
    errors.push(`${where}: provide exactly one of "value" or "valueFrom"`);
    return;
  }
  if (hasFrom) {
    if (typeof c.valueFrom !== 'string' || !ATTR_RE.test(c.valueFrom)) {
      errors.push(`${where}: "valueFrom" must look like subject.x, resource.x or env.x`);
    }
    return;
  }
  if ((c.op === 'in' || c.op === 'nin') && !Array.isArray(c.value)) {
    errors.push(`${where}: "${c.op}" requires an array value`);
  }
  if (['gt', 'gte', 'lt', 'lte'].includes(c.op) && !['number', 'string'].includes(typeof c.value)) {
    errors.push(`${where}: "${c.op}" requires a number or string value`);
  }
}

function validatePolicy(p, index, errors, actionVocab) {
  const where = `policies[${index}]${p && p.id ? ` (${p.id})` : ''}`;
  if (!isPlainObject(p)) return errors.push(`${where}: must be an object`);

  for (const k of Object.keys(p)) {
    if (!POLICY_KEYS.includes(k)) errors.push(`${where}: unknown key "${k}" (allowed: ${POLICY_KEYS.join(', ')})`);
  }
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) errors.push(`${where}: "id" must match ${ID_RE}`);
  if (!['allow', 'deny'].includes(p.effect)) errors.push(`${where}: "effect" must be "allow" or "deny"`);
  if (p.description !== undefined && typeof p.description !== 'string') errors.push(`${where}: "description" must be a string`);
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') errors.push(`${where}: "enabled" must be a boolean`);

  if (!Array.isArray(p.actions) || p.actions.length === 0) {
    errors.push(`${where}: "actions" must be a non-empty array`);
  } else {
    for (const a of p.actions) {
      if (a !== '*' && !actionVocab.includes(a)) {
        errors.push(`${where}: unknown action "${a}" (known: ${actionVocab.join(', ')}, or "*")`);
      }
    }
  }
  if (!Array.isArray(p.resources) || p.resources.length === 0 || p.resources.some((r) => typeof r !== 'string' || !r)) {
    errors.push(`${where}: "resources" must be a non-empty array of strings (use "*" for all)`);
  }
  if (p.conditions !== undefined) {
    if (!Array.isArray(p.conditions)) errors.push(`${where}: "conditions" must be an array`);
    else p.conditions.forEach((c, i) => validateCondition(c, `${where}.conditions[${i}]`, errors));
  }
}

/** Fill defaults so every stored/evaluated policy has the same shape. */
function normalizePolicy(p) {
  return {
    id: p.id,
    description: p.description || '',
    effect: p.effect,
    enabled: p.enabled !== false,
    actions: [...p.actions],
    resources: [...p.resources],
    conditions: (p.conditions || []).map((c) => {
      const out = { attr: c.attr, op: c.op };
      if (Object.prototype.hasOwnProperty.call(c, 'valueFrom')) out.valueFrom = c.valueFrom;
      else if (c.op === 'exists') out.value = c.value === undefined ? true : c.value;
      else out.value = c.value;
      return out;
    }),
  };
}

/**
 * Validate a whole policy document ({ version, policies: [...] }).
 * Returns { ok, errors, policies } — policies are normalized when ok.
 */
function validateDocument(doc, { actions = DEFAULT_ACTIONS } = {}) {
  const errors = [];
  if (!isPlainObject(doc)) return { ok: false, errors: ['document must be a JSON object'], policies: [] };
  for (const k of Object.keys(doc)) {
    if (!['version', 'policies', '$comment'].includes(k)) errors.push(`unknown top-level key "${k}"`);
  }
  if (doc.version !== 1) errors.push('"version" must be 1');
  if (!Array.isArray(doc.policies)) {
    errors.push('"policies" must be an array');
    return { ok: false, errors, policies: [] };
  }
  const seen = new Set();
  doc.policies.forEach((p, i) => {
    validatePolicy(p, i, errors, actions);
    if (p && typeof p.id === 'string') {
      if (seen.has(p.id)) errors.push(`policies[${i}]: duplicate id "${p.id}"`);
      seen.add(p.id);
    }
  });
  if (errors.length) return { ok: false, errors, policies: [] };
  return { ok: true, errors: [], policies: doc.policies.map(normalizePolicy) };
}

module.exports = {
  DEFAULT_ACTIONS,
  OPERATORS,
  PolicyValidationError,
  validateDocument,
  normalizePolicy,
};
