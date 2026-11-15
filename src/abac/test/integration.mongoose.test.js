'use strict';
/**
 * Optional end-to-end test against a REAL MongoDB (e.g. a throwaway database on Atlas).
 *
 *   MONGO_URI="mongodb+srv://user:pass@cluster/abac_test" npm test
 *
 * Skipped when MONGO_URI is not set. It uses uniquely named collections and drops
 * them afterwards; it never touches your real policy or audit collections.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mongoose;
try { mongoose = require('mongoose'); } catch { /* skipped */ }
const skip = !process.env.MONGO_URI ? 'set MONGO_URI to run' : !mongoose ? 'mongoose is not installed' : false;

test('real MongoDB: sync, hot reload, audit, drift repair', { skip, timeout: 60000 }, async () => {
  const { createAbac } = require('../index');
  const { once } = require('./helpers');
  const suffix = `${Date.now()}`;
  const collections = { policyCollection: `abac_policies_test_${suffix}`, auditCollection: `abac_audit_test_${suffix}` };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abac-int-'));
  const file = path.join(dir, 'policies.json');
  const write = (policies) => fs.writeFileSync(file, JSON.stringify({ version: 1, policies }));
  const p = (id, extra = {}) => ({ id, effect: 'allow', actions: ['read'], resources: ['*'], ...extra });

  await mongoose.connect(process.env.MONGO_URI);
  write([p('a', { conditions: [{ attr: 'resource.createdBy', op: 'eq', valueFrom: 'subject.id' }] }), p('b')]);
  const abac = await createAbac({ mongoose, policyFile: file, collections, reconcileIntervalMs: 0, logger: { error() {}, log() {} } });
  const { Policy, Audit } = abac.models;
  try {
    assert.equal(abac.store.dbSynced, true);
    assert.equal(await Policy.countDocuments(), 2);
    assert.equal(await Audit.countDocuments({ change: 'created' }), 2);

    const reloaded = once(abac.store, 'reload', 10000);
    write([p('a', { effect: 'deny' }), p('c')]);
    await reloaded;
    assert.equal((await Policy.findOne({ policyId: 'a' }).lean()).effect, 'deny');
    assert.equal(await Policy.countDocuments({ policyId: 'b' }), 0);
    assert.equal(await Audit.countDocuments({ change: 'deleted', policyId: 'b' }), 1);

    await Policy.updateOne({ policyId: 'a' }, { effect: 'allow' }); // drift
    await abac.store.reconcile();
    assert.equal((await Policy.findOne({ policyId: 'a' }).lean()).effect, 'deny');
  } finally {
    abac.close();
    await Policy.collection.drop().catch(() => {});
    await Audit.collection.drop().catch(() => {});
    await mongoose.disconnect();
  }
});
