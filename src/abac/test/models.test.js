'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let mongoose;
try { mongoose = require('mongoose'); } catch { /* skipped below */ }
const skip = mongoose ? false : 'mongoose is not installed';

test('schemas compile, are reusable, and keep condition objects intact', { skip }, () => {
  const createModels = require('../lib/models');
  const a = createModels(mongoose);
  const b = createModels(mongoose); // second call must not throw OverwriteModelError
  assert.equal(a.Policy, b.Policy);

  const doc = new a.Policy({
    policyId: 'p', effect: 'allow', actions: ['read'], resources: ['*'],
    conditions: [{ attr: 'subject.role', op: 'in', value: ['admin'] }, { attr: 'resource.createdBy', op: 'eq', valueFrom: 'subject.id' }],
  });
  assert.equal(doc.validateSync(), undefined);
  assert.deepEqual(doc.toObject().conditions, [
    { attr: 'subject.role', op: 'in', value: ['admin'] },
    { attr: 'resource.createdBy', op: 'eq', valueFrom: 'subject.id' },
  ]);
  assert.ok(new a.Policy({ policyId: 'p', effect: 'permit' }).validateSync(), 'bad effect rejected');
  assert.equal(new a.Audit({ change: 'created' }).validateSync(), undefined);
  assert.ok(new a.Audit({ change: 'exploded' }).validateSync());
});
