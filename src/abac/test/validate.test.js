'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDocument } = require('../lib/validate');

const base = { id: 'p1', effect: 'allow', actions: ['read'], resources: ['*'] };
const doc = (...policies) => ({ version: 1, policies });
const errorsOf = (d, opts) => validateDocument(d, opts).errors.join('\n');

test('a minimal policy is valid and gets defaults', () => {
  const r = validateDocument(doc(base));
  assert.equal(r.ok, true);
  assert.deepEqual(r.policies[0], { ...base, description: '', enabled: true, conditions: [] });
});

test('catches typos and structural errors', () => {
  assert.match(errorsOf(doc({ ...base, condtions: [] })), /unknown key "condtions"/);
  assert.match(errorsOf(doc({ ...base, effect: 'permit' })), /"effect" must be/);
  assert.match(errorsOf(doc({ ...base, actions: ['reed'] })), /unknown action "reed"/);
  assert.match(errorsOf(doc({ ...base, actions: [] })), /non-empty/);
  assert.match(errorsOf(doc({ ...base, id: 'bad id!' })), /"id" must match/);
  assert.match(errorsOf(doc(base, base)), /duplicate id/);
  assert.match(errorsOf({ version: 2, policies: [] }), /"version" must be 1/);
  assert.match(errorsOf({ version: 1 }), /"policies" must be an array/);
  assert.match(errorsOf([]), /JSON object/);
});

test('custom action vocabulary', () => {
  assert.equal(validateDocument(doc({ ...base, actions: ['publish'] }), { actions: ['publish'] }).ok, true);
  assert.equal(validateDocument(doc({ ...base, actions: ['publish'] })).ok, false);
});

test('condition validation', () => {
  const c = (cond) => errorsOf(doc({ ...base, conditions: [cond] }));
  assert.match(c({ attr: 'user.role', op: 'eq', value: 1 }), /"attr" must look like/);
  assert.match(c({ attr: 'subject.role', op: 'like', value: 1 }), /"op" must be one of/);
  assert.match(c({ attr: 'subject.role', op: 'eq' }), /exactly one of/);
  assert.match(c({ attr: 'subject.role', op: 'eq', value: 1, valueFrom: 'subject.id' }), /exactly one of/);
  assert.match(c({ attr: 'subject.role', op: 'in', value: 'admin' }), /requires an array/);
  assert.match(c({ attr: 'subject.age', op: 'gt', value: {} }), /number or string/);
  assert.match(c({ attr: 'subject.role', op: 'eq', value: 1, extra: 1 }), /unknown condition key/);
  assert.match(c({ attr: 'resource.a', op: 'eq', valueFrom: 'nope' }), /"valueFrom" must look like/);
  assert.equal(validateDocument(doc({ ...base, conditions: [{ attr: 'resource.a', op: 'exists' }] })).policies[0].conditions[0].value, true);
});
