'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { evaluate } = require('../lib/engine');
const { validateDocument } = require('../lib/validate');

const sample = validateDocument(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'policies.example.json'), 'utf8')));
assert.ok(sample.ok, sample.errors.join('\n'));
const P = sample.policies;

const can = (subject, action, resourceType, resource, policies = P) =>
  evaluate(policies, { subject, action, resourceType, resource }).allowed;

const admin = { id: 'a1', role: 'admin' };
const superAdmin = { id: 's1', role: 'superAdmin' };
const alice = { id: 'u1', role: 'user' };
const bob = { id: 'u2', role: 'user' };

test('admin and superAdmin can do everything', () => {
  for (const s of [admin, superAdmin]) {
    for (const a of ['read', 'create', 'update', 'delete']) {
      assert.equal(can(s, a, 'posts', { createdBy: 'someone-else' }), true, `${s.role} ${a}`);
    }
  }
});

test('array roles work (any matching role)', () => {
  assert.equal(can({ id: 'x', role: ['user', 'admin'] }, 'delete', 'posts', { createdBy: 'other' }), true);
});

test('users can read and create', () => {
  assert.equal(can(alice, 'read', 'posts', { createdBy: 'u2' }), true);
  assert.equal(can(alice, 'create', 'posts'), true);
});

test('users can update/delete only their own documents', () => {
  for (const a of ['update', 'delete']) {
    assert.equal(can(alice, a, 'posts', { createdBy: 'u1' }), true);
    assert.equal(can(alice, a, 'posts', { createdBy: 'u2' }), false);
    assert.equal(can(bob, a, 'posts', { createdBy: 'u1' }), false);
  }
});

test('missing data fails closed', () => {
  assert.equal(can(alice, 'update', 'posts', {}), false, 'no createdBy');
  assert.equal(can(alice, 'update', 'posts'), false, 'no resource');
  assert.equal(can({ role: 'user' }, 'update', 'posts', { createdBy: undefined }), false, 'no subject id, no owner');
  assert.equal(can({ role: 'user' }, 'read', 'posts', {}), false, 'no subject id at all');
});

test('deny always wins, even over admin', () => {
  const d = evaluate(P, { subject: { ...admin, status: 'suspended' }, action: 'read', resourceType: 'posts' });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'explicit-deny');
  assert.deepEqual(d.deny, ['deny-suspended-subjects']);
  assert.ok(d.allow.includes('admins-full-access'));
});

test('default is deny when nothing matches', () => {
  assert.equal(evaluate([], { subject: admin, action: 'read', resourceType: 'posts' }).reason, 'default-deny');
  assert.equal(can(alice, 'read', 'posts', {}, []), false);
});

test('non-admins cannot touch the permission system itself', () => {
  assert.equal(can(alice, 'read', 'abac-policies'), false);
  assert.equal(can(alice, 'read', 'abac-audit'), false);
  assert.equal(can(admin, 'update', 'abac-policies'), true);
});

test('an unresolved valueFrom counts as TRUE for deny policies (fail closed)', () => {
  const policies = validateDocument({
    version: 1,
    policies: [
      { id: 'allow-all', effect: 'allow', actions: ['read'], resources: ['*'] },
      { id: 'deny-others', effect: 'deny', actions: ['read'], resources: ['*'],
        conditions: [{ attr: 'resource.team', op: 'ne', valueFrom: 'subject.team' }] },
    ],
  }).policies;
  assert.equal(can({ id: '1', team: 'red' }, 'read', 'x', { team: 'red' }, policies), true);
  assert.equal(can({ id: '1', team: 'red' }, 'read', 'x', { team: 'blue' }, policies), false);
  assert.equal(can({ id: '1' }, 'read', 'x', { team: 'blue' }, policies), false, 'subject has no team');
});

test('ObjectId-like values are compared as strings', () => {
  const oid = (hex) => ({ _bsontype: 'ObjectId', toString: () => hex });
  assert.equal(can({ id: oid('64b'), role: 'user' }, 'update', 'posts', { createdBy: '64b' }), true);
  assert.equal(can({ id: '64b', role: 'user' }, 'update', 'posts', { createdBy: oid('64b') }), true);
  assert.equal(can({ id: '64b', role: 'user' }, 'update', 'posts', { createdBy: oid('999') }), false);
});

test('Mongoose-style documents (toObject, _id) are understood', () => {
  const subject = { toObject: () => ({ _id: 'u1', role: 'user' }) };
  const resource = { toObject: () => ({ _id: 'p1', createdBy: 'u1' }) };
  assert.equal(can(subject, 'update', 'posts', resource), true);
});

test('operators', () => {
  const run = (cond, subject, resource) =>
    evaluate(
      validateDocument({ version: 1, policies: [{ id: 'p', effect: 'allow', actions: ['read'], resources: ['*'], conditions: [cond] }] }).policies,
      { subject, action: 'read', resourceType: 'x', resource }
    ).allowed;

  assert.equal(run({ attr: 'resource.rating', op: 'lte', value: 13 }, {}, { rating: 13 }), true);
  assert.equal(run({ attr: 'resource.rating', op: 'lte', value: 13 }, {}, { rating: 17 }), false);
  assert.equal(run({ attr: 'resource.rating', op: 'lte', value: 13 }, {}, { rating: '10' }), false, 'no type coercion');
  assert.equal(run({ attr: 'resource.tags', op: 'contains', value: 'a' }, {}, { tags: ['a', 'b'] }), true);
  assert.equal(run({ attr: 'resource.tags', op: 'contains', value: 'z' }, {}, { tags: ['a', 'b'] }), false);
  assert.equal(run({ attr: 'resource.draft', op: 'exists', value: false }, {}, {}), true);
  assert.equal(run({ attr: 'resource.draft', op: 'exists', value: false }, {}, { draft: true }), false);
  assert.equal(run({ attr: 'resource.kind', op: 'in', value: ['a', 'b'] }, {}, { kind: 'b' }), true);
  assert.equal(run({ attr: 'resource.kind', op: 'nin', value: ['a', 'b'] }, {}, { kind: 'b' }), false);
  assert.equal(run({ attr: 'env.hour', op: 'gte', value: 9 }, {}, {}), false, 'env missing');
});

test('paths run through arrays of objects (MongoDB multikey semantics)', () => {
  const policies = validateDocument({
    version: 1,
    policies: [
      { id: 'guests', effect: 'allow', actions: ['read'], resources: ['events'],
        conditions: [{ attr: 'resource.guests._id', op: 'in', valueFrom: 'subject.identifiers' }] },
    ],
  }).policies;
  const oid = (hex) => ({ _bsontype: 'ObjectId', toString: () => hex });
  const event = { guests: [{ name: 'host' }, { _id: 'a@x.com' }, { _id: oid('64b') }] };
  const run = (identifiers, resource = event) =>
    evaluate(policies, { subject: { id: 's', identifiers }, action: 'read', resourceType: 'events', resource }).allowed;

  assert.equal(run(['64b']), true, 'ObjectId element matches its string form');
  assert.equal(run(['zzz', 'a@x.com']), true, 'email element');
  assert.equal(run(['nope']), false);
  assert.equal(run(['a@x.com'], { guests: [] }), false, 'empty array');
  assert.equal(run(['a@x.com'], {}), false, 'missing array');
  assert.equal(run(['a@x.com'], { guests: [{ name: 'no id' }] }), false, 'elements without the field');
  assert.equal(evaluate(policies, { subject: { id: 's' }, action: 'read', resourceType: 'events', resource: event }).allowed, false, 'subject without identifiers');
});

test('disabled policies are ignored', () => {
  const policies = P.map((p) => (p.id === 'admins-full-access' ? { ...p, enabled: false } : p));
  assert.equal(can(admin, 'delete', 'posts', { createdBy: 'other' }, policies), false);
});

test('explain mode returns a readable trace', () => {
  const d = evaluate(P, { subject: alice, action: 'update', resourceType: 'posts', resource: { createdBy: 'u2' } }, { explain: true });
  assert.equal(d.allowed, false);
  const owners = d.trace.find((t) => t.policyId === 'owners-update-delete-own');
  assert.equal(owners.applies, false);
  assert.equal(owners.conditions[0].actual, 'u2');
  assert.equal(owners.conditions[0].expected, 'u1');
});
