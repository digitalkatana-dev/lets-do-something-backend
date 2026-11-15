'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { PolicyStore } = require('../lib/store');
const { fakeModels, tmpPolicyFile, quietLogger, once, wait } = require('./helpers');

const pol = (id, extra = {}) => ({ id, effect: 'allow', actions: ['read'], resources: ['*'], ...extra });
const docOf = (...policies) => ({ version: 1, policies });
const write = (file, doc) => fs.writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));

function makeStore(file, models, extra = {}) {
  return new PolicyStore({
    filePath: file, models, logger: quietLogger, debounceMs: 30, reconcileIntervalMs: 0,
    actions: ['read', 'create', 'update', 'delete'], ...extra,
  });
}

test('startup mirrors the file to the DB and audits creations; a restart with no change is silent', async () => {
  const file = tmpPolicyFile(docOf(pol('a'), pol('b')));
  const m = fakeModels();
  const s1 = makeStore(file, m);
  await s1.init();
  s1.close();
  assert.deepEqual([...m.policies.keys()].sort(), ['a', 'b']);
  assert.deepEqual(m.audit.map((e) => [e.policyId, e.change, e.source]), [['a', 'created', 'startup'], ['b', 'created', 'startup']]);

  const s2 = makeStore(file, m);
  await s2.init();
  s2.close();
  assert.equal(m.audit.length, 2, 'no new audit entries when nothing changed');
});

test('hot reload: editing the file updates enforcement, DB and audit without a restart', async () => {
  const file = tmpPolicyFile(docOf(pol('a'), pol('b')));
  const m = fakeModels();
  const s = makeStore(file, m);
  await s.init();
  m.audit.length = 0;

  const reloaded = once(s, 'reload');
  write(file, docOf(pol('a', { effect: 'deny' }), pol('c')));
  await reloaded;
  s.close();

  assert.deepEqual(s.policies.map((p) => [p.id, p.effect]), [['a', 'deny'], ['c', 'allow']]);
  assert.deepEqual([...m.policies.keys()].sort(), ['a', 'c']);
  const byId = Object.fromEntries(m.audit.map((e) => [e.policyId, e]));
  assert.equal(byId.a.change, 'updated');
  assert.equal(byId.a.before.effect, 'allow');
  assert.equal(byId.a.after.effect, 'deny');
  assert.equal(byId.b.change, 'deleted');
  assert.equal(byId.c.change, 'created');
  assert.ok(m.audit.every((e) => e.source === 'file-watch' && e.fileHash));
});

test('an invalid edit is rejected: old policies stay active and the rejection is audited once', async () => {
  const file = tmpPolicyFile(docOf(pol('a')));
  const m = fakeModels();
  const s = makeStore(file, m);
  await s.init();
  m.audit.length = 0;

  const invalid = once(s, 'invalid');
  write(file, '{ "version": 1, "policies": [ { "id": "a", "effect": "permit" } ');
  await invalid;
  assert.deepEqual(s.policies.map((p) => p.id), ['a']);
  assert.equal(s.policies[0].effect, 'allow');

  const invalid2 = once(s, 'invalid');
  write(file, docOf(pol('a', { actions: ['reed'] })));
  await invalid2;
  s.close();
  assert.equal(m.audit.filter((e) => e.change === 'rejected').length, 2);
  assert.match(m.audit[0].note, /not valid JSON/);
  assert.match(m.audit[1].note, /unknown action "reed"/);
  assert.equal(m.policies.get('a').effect, 'allow', 'DB mirror untouched');
});

test('an invalid file at startup refuses to boot', async () => {
  const file = tmpPolicyFile(docOf(pol('a', { effect: 'maybe' })));
  const s = makeStore(file, fakeModels());
  await assert.rejects(() => s.init(), /Invalid policies/);
});

test('DB outage: file policies are still enforced, and the mirror catches up later', async () => {
  const file = tmpPolicyFile(docOf(pol('a')));
  const m = fakeModels();
  m.state.down = true;
  const s = makeStore(file, m);
  await s.init();
  assert.deepEqual(s.policies.map((p) => p.id), ['a'], 'enforced from file');
  assert.equal(s.dbSynced, false);
  assert.match(s.lastSyncError.message, /outage/);

  m.state.down = false;
  await s.reconcile();
  s.close();
  assert.equal(s.dbSynced, true);
  assert.deepEqual([...m.policies.keys()], ['a']);
  assert.equal(m.audit.length, 1);
  assert.equal(m.audit[0].source, 'reconcile');
});

test('drift: a manual DB edit is overwritten and audited', async () => {
  const file = tmpPolicyFile(docOf(pol('a')));
  const m = fakeModels();
  const s = makeStore(file, m);
  await s.init();
  m.policies.get('a').effect = 'deny'; // someone edits the DB by hand
  m.policies.set('rogue', { policyId: 'rogue', effect: 'allow', actions: ['*'], resources: ['*'], conditions: [], enabled: true });
  m.audit.length = 0;

  await s.reconcile();
  s.close();
  assert.equal(m.policies.get('a').effect, 'allow');
  assert.equal(m.policies.has('rogue'), false);
  assert.deepEqual(m.audit.map((e) => [e.policyId, e.change, e.source]).sort(), [['a', 'updated', 'reconcile'], ['rogue', 'deleted', 'reconcile']]);
});

test('mutate(): writes the file atomically, syncs, audits with the actor, and the watcher does not double-apply', async () => {
  const file = tmpPolicyFile(docOf(pol('a')));
  const m = fakeModels();
  const s = makeStore(file, m);
  await s.init();
  m.audit.length = 0;

  await s.mutate((d) => { d.policies.push(pol('b')); }, { actor: 'admin-7' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).policies.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(s.policies.map((p) => p.id), ['a', 'b']);
  await wait(150); // let the file watcher fire
  s.close();
  assert.deepEqual(m.audit.map((e) => [e.policyId, e.change, e.actor, e.source]), [['b', 'created', 'admin-7', 'admin-api']]);
  assert.equal(fs.readdirSync(require('path').dirname(file)).filter((f) => f.endsWith('.tmp')).length, 0);
});

test('mutate(): invalid edits throw and leave the file untouched; read-only mode refuses', async () => {
  const file = tmpPolicyFile(docOf(pol('a')));
  const before = fs.readFileSync(file, 'utf8');
  const s = makeStore(file, fakeModels());
  await s.init();
  await assert.rejects(() => s.mutate((d) => { d.policies.push({ id: 'x' }); }), /Invalid policies/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  s.close();

  const ro = makeStore(file, fakeModels(), { writable: false });
  await ro.init();
  await assert.rejects(() => ro.mutate((d) => d), (e) => e.code === 'ABAC_READ_ONLY');
  ro.close();
});

test('concurrent mutations are serialized (none are lost)', async () => {
  const file = tmpPolicyFile(docOf(pol('a')));
  const s = makeStore(file, fakeModels());
  await s.init();
  await Promise.all(['b', 'c', 'd', 'e'].map((id) => s.mutate((d) => { d.policies.push(pol(id)); })));
  s.close();
  assert.deepEqual(s.policies.map((p) => p.id).sort(), ['a', 'b', 'c', 'd', 'e']);
});
