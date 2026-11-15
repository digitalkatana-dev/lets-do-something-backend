'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { evaluate } = require('../lib/engine');
const { buildFilter, scope, FilterUnsupportedError } = require('../lib/filter');
const { validateDocument } = require('../lib/validate');
const { mongoMatch } = require('./helpers');

const load = (doc) => {
  const r = validateDocument(doc);
  assert.ok(r.ok, r.errors.join('\n'));
  return r.policies;
};
const sample = load(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'policies.example.json'), 'utf8')));

const extra = load({
  version: 1,
  policies: [
    { id: 'read-published', effect: 'allow', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.status', op: 'eq', value: 'published' }] },
    { id: 'read-own-team', effect: 'allow', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.team', op: 'in', value: ['red', 'blue'] }, { attr: 'resource.team', op: 'eq', valueFrom: 'subject.team' }] },
    { id: 'read-low-rating', effect: 'allow', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.rating', op: 'lte', value: 13 }, { attr: 'subject.minor', op: 'eq', value: true }] },
    { id: 'read-tagged', effect: 'allow', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.tags', op: 'contains', value: 'public' }] },
    { id: 'read-undrafted', effect: 'allow', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.draft', op: 'exists', value: false }, { attr: 'subject.role', op: 'eq', value: 'editor' }] },
    { id: 'deny-secret', effect: 'deny', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.level', op: 'gt', value: 5 }, { attr: 'subject.role', op: 'nin', value: ['admin', 'superAdmin'] }] },
    { id: 'deny-banned-tag', effect: 'deny', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.tags', op: 'contains', value: 'banned' }] },
    { id: 'deny-other-team', effect: 'deny', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.team', op: 'ne', valueFrom: 'subject.team' }, { attr: 'subject.isolated', op: 'eq', value: true }] },
    { id: 'read-if-guest', effect: 'allow', actions: ['read'], resources: ['posts'],
      conditions: [{ attr: 'resource.guests._id', op: 'in', valueFrom: 'subject.identifiers' }] },
  ],
});

const subjects = [
  { id: 'u1', role: 'user' },
  { id: 'u2', role: 'user', team: 'red' },
  { id: 'u3', role: 'user', team: 'blue', minor: true },
  { id: 'e1', role: 'editor', team: 'red' },
  { id: 'i1', role: 'user', team: 'red', isolated: true },
  { id: 'a1', role: 'admin' },
  { role: 'user' }, // no id
  { id: 'x', role: 'user', status: 'suspended' },
  { id: 'g1', role: 'user', identifiers: ['g1', 'g@x.com'] },
];
const resources = [
  {}, { createdBy: 'u1' }, { createdBy: 'u2', team: 'red' }, { createdBy: 'u3', team: 'blue', rating: 10 },
  { status: 'published', level: 9 }, { status: 'draft', tags: ['public'] }, { tags: ['banned', 'public'] },
  { team: 'green', draft: true, rating: 17 }, { level: 3, tags: [] }, { createdBy: 'a1', team: 'red', draft: false },
  { guests: [{ name: 'host' }, { _id: 'g@x.com' }] }, { guests: [{ _id: 'g1' }, { _id: 'other' }], level: 9 }, { guests: [] },
];

test('buildFilter agrees with evaluate() for every subject x resource x action', () => {
  for (const [name, policies] of [['sample', sample], ['extra', [...sample, ...extra]]]) {
    for (const action of ['read', 'create', 'update', 'delete']) {
      for (const subject of subjects) {
        const { mode, filter } = buildFilter(policies, { subject, action, resourceType: 'posts' });
        for (const resource of resources) {
          const expected = evaluate(policies, { subject, action, resourceType: 'posts', resource }).allowed;
          const actual = mode === 'none' ? false : mode === 'all' ? true : mongoMatch(resource, filter);
          assert.equal(
            actual, expected,
            `${name}: ${action} by ${JSON.stringify(subject)} on ${JSON.stringify(resource)} -> mode=${mode} filter=${JSON.stringify(filter)}`
          );
        }
      }
    }
  }
});

test('modes for the sample policies', () => {
  const f = (subject, action) => buildFilter(sample, { subject, action, resourceType: 'posts' });
  assert.deepEqual(f({ id: 'a1', role: 'admin' }, 'update'), { mode: 'all', filter: {} });
  assert.deepEqual(f({ id: 'u1', role: 'user' }, 'read'), { mode: 'all', filter: {} });
  assert.deepEqual(f({ id: 'u1', role: 'user' }, 'delete'), { mode: 'filter', filter: { createdBy: 'u1' } });
  assert.equal(f({ id: 'a1', role: 'admin', status: 'suspended' }, 'read').mode, 'none');
  assert.equal(f({ id: 'u1', role: 'user' }, 'read').mode, 'all');
  assert.equal(buildFilter(sample, { subject: { id: 'u1', role: 'user' }, action: 'read', resourceType: 'abac-policies' }).mode, 'none');
});

test('resource.id maps to idField', () => {
  const policies = load({ version: 1, policies: [{ id: 'p', effect: 'allow', actions: ['read'], resources: ['*'],
    conditions: [{ attr: 'resource.id', op: 'in', valueFrom: 'subject.allowedIds' }] }] });
  const r = buildFilter(policies, { subject: { allowedIds: ['1', '2'] }, action: 'read', resourceType: 'x' });
  assert.deepEqual(r.filter, { _id: { $in: ['1', '2'] } });
});

test('comparing two resource attributes is rejected with a clear error', () => {
  const policies = load({ version: 1, policies: [{ id: 'p', effect: 'allow', actions: ['read'], resources: ['*'],
    conditions: [{ attr: 'resource.a', op: 'eq', valueFrom: 'resource.b' }] }] });
  assert.throws(() => buildFilter(policies, { subject: {}, action: 'read', resourceType: 'x' }), FilterUnsupportedError);
});

test('scope() ANDs with the caller query without clobbering $or / $and', () => {
  assert.deepEqual(scope({ createdBy: 'u1' }, { $or: [{ a: 1 }, { b: 2 }] }), { $and: [{ createdBy: 'u1' }, { $or: [{ a: 1 }, { b: 2 }] }] });
  assert.deepEqual(scope({}, { a: 1 }), { a: 1 });
  assert.deepEqual(scope({ a: 1 }, {}), { a: 1 });
  assert.deepEqual(scope({}, undefined), {});
});
