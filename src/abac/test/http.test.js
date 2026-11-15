'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createAbac } = require('../index');
const { fakeModels, quietLogger, mongoMatch } = require('./helpers');

let express;
try { express = require('express'); } catch { /* skipped below */ }

const POLICY_FILE_SRC = path.join(__dirname, '..', 'policies.example.json');

const users = {
  admin: { id: 'a1', role: 'admin' },
  alice: { id: 'u1', role: 'user' },
  bob: { id: 'u2', role: 'user' },
  ghost: { id: 'g1', role: 'admin', status: 'suspended' },
};

const posts = [
  { _id: 'p1', createdBy: 'u1', title: 'alice post' },
  { _id: 'p2', createdBy: 'u2', title: 'bob post' },
];

async function boot({ adminWritable = true, extraPolicies = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'abac-http-'));
  const file = path.join(dir, 'policies.json');
  const source = JSON.parse(fs.readFileSync(POLICY_FILE_SRC, 'utf8'));
  source.policies.push(...extraPolicies);
  fs.writeFileSync(file, JSON.stringify(source, null, 2));
  const models = fakeModels();
  const decisions = [];
  const abac = await createAbac({
    models, policyFile: file, logger: quietLogger, reconcileIntervalMs: 0, adminWritable,
    onDecision: (req, d) => decisions.push([req.action, req.resourceType, d.allowed]),
  });

  const app = express();
  app.use((req, _res, next) => { // stand-in for your real auth middleware
    const who = req.get('x-user');
    if (who) req.user = users[who];
    next();
  });
  const { authorize } = abac;

  app.get('/posts', authorize('read', 'posts', { filter: true }), (req, res) =>
    res.json({ filter: req.abac.filter, items: posts.filter((p) => mongoMatch(p, req.abac.scope({}))) }));
  app.get('/my-posts', authorize('delete', 'posts', { filter: true }), (req, res) =>
    res.json(posts.filter((p) => mongoMatch(p, req.abac.scope({})))));
  app.post('/posts', authorize('create', 'posts'), (req, res) => res.status(201).json({ ok: true }));
  const load = { model: null };
  load.model = { findOne: ({ _id }) => ({ lean: async () => { if (_id === 'bad') { const e = new Error('cast'); e.name = 'CastError'; throw e; } return posts.find((p) => p._id === _id) || null; } }) };
  app.put('/posts/:id', authorize('update', 'posts', { load }), (req, res) => res.json({ ok: true, resource: req.abac.resource }));
  app.delete('/posts/:id', authorize('delete', 'posts', { load, onMissing: 403 }), (req, res) => res.json({ ok: true }));
  app.get('/notices', authorize('read', 'notices', { anonymous: true }), (req, res) => res.json({ ok: true }));
  app.get('/anon-posts', authorize('read', 'posts', { anonymous: true }), (req, res) => res.json({ ok: true }));
  app.get('/strict-notices', authorize('read', 'notices'), (req, res) => res.json({ ok: true }));
  app.get('/boom', (req, res) => { abac.assert(req.user, 'delete', 'posts', { createdBy: 'nobody' }); res.end(); });
  app.use('/abac', abac.adminRouter());
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { as, body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(as ? { 'x-user': as } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { abac, models, file, call, decisions, close: () => { abac.close(); server.close(); } };
}

const skip = express ? false : 'express is not installed';

test('route middleware: 401, ownership checks, admin override, 404, deny-wins', { skip }, async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('PUT', '/posts/p1')).status, 401);
    assert.equal((await t.call('PUT', '/posts/p1', { as: 'alice' })).status, 200);
    assert.equal((await t.call('PUT', '/posts/p2', { as: 'alice' })).status, 403);
    assert.equal((await t.call('PUT', '/posts/p2', { as: 'admin' })).status, 200);
    assert.equal((await t.call('PUT', '/posts/zzz', { as: 'alice' })).status, 404);
    assert.equal((await t.call('PUT', '/posts/bad', { as: 'alice' })).status, 404, 'malformed id');
    assert.equal((await t.call('DELETE', '/posts/zzz', { as: 'alice' })).status, 403, 'onMissing: 403');
    assert.equal((await t.call('POST', '/posts', { as: 'alice' })).status, 201);
    assert.equal((await t.call('PUT', '/posts/p1', { as: 'ghost' })).status, 403, 'suspended admin');
    const ok = await t.call('PUT', '/posts/p1', { as: 'alice' });
    assert.equal(ok.body.resource.createdBy, 'u1', 'loaded doc exposed as req.abac.resource');
    assert.ok(t.decisions.length > 5, 'onDecision hook fires');
  } finally { t.close(); }
});

test('list filtering via req.abac.scope', { skip }, async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('GET', '/posts', { as: 'bob' })).body.items.length, 2, 'users may read all');
    const mine = await t.call('GET', '/my-posts', { as: 'alice' });
    assert.deepEqual(mine.body.map((p) => p._id), ['p1']);
    assert.equal((await t.call('GET', '/my-posts', { as: 'admin' })).body.length, 2);
    assert.equal((await t.call('GET', '/posts', { as: 'ghost' })).status, 403);
    assert.equal((await t.call('GET', '/posts')).status, 401);
  } finally { t.close(); }
});

test('anonymous: true lets a policy decide public routes; otherwise 401', { skip }, async () => {
  const t = await boot({
    extraPolicies: [{ id: 'public-notices', effect: 'allow', actions: ['read'], resources: ['notices'] }],
  });
  try {
    assert.equal((await t.call('GET', '/notices')).status, 200, 'anonymous, allowed by policy');
    assert.equal((await t.call('GET', '/notices', { as: 'alice' })).status, 200);
    assert.equal((await t.call('GET', '/strict-notices')).status, 401, 'no anonymous flag -> 401');
    assert.equal((await t.call('GET', '/anon-posts')).status, 403, 'anonymous but no policy allows posts');
    assert.equal((await t.call('GET', '/anon-posts', { as: 'alice' })).status, 200);
  } finally { t.close(); }
});

test('abac.assert throws ForbiddenError with status 403', { skip }, async () => {
  const t = await boot();
  try {
    const r = await t.call('GET', '/boom', { as: 'alice' });
    assert.equal(r.status, 403);
    assert.throws(() => t.abac.check({ subject: users.alice, action: 'frobnicate', resourceType: 'x' }), /Unknown action/);
    assert.equal(t.abac.can(users.admin, 'delete', 'anything', {}), true);
  } finally { t.close(); }
});

test('admin API is itself permission-protected', { skip }, async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('GET', '/abac/policies')).status, 401);
    assert.equal((await t.call('GET', '/abac/policies', { as: 'alice' })).status, 403);
    assert.equal((await t.call('GET', '/abac/audit', { as: 'alice' })).status, 403);
    assert.equal((await t.call('POST', '/abac/policies', { as: 'alice', body: { id: 'x' } })).status, 403);
    const list = await t.call('GET', '/abac/policies', { as: 'admin' });
    assert.equal(list.status, 200);
    assert.equal(list.body.policies.length, 5);
  } finally { t.close(); }
});

test('admin API: create / update / delete / validate / check / audit / status', { skip }, async () => {
  const t = await boot();
  try {
    const newPolicy = {
      id: 'deny-kids-adult-content', effect: 'deny', actions: ['read'], resources: ['titles'],
      conditions: [{ attr: 'resource.rating', op: 'gt', valueFrom: 'subject.maxRating' }],
    };
    assert.equal((await t.call('POST', '/abac/policies', { as: 'admin', body: newPolicy })).status, 201);
    assert.ok(JSON.parse(fs.readFileSync(t.file, 'utf8')).policies.some((p) => p.id === newPolicy.id), 'file is the source of truth');
    assert.ok(t.models.policies.has(newPolicy.id), 'mirrored to DB');
    assert.equal((await t.call('POST', '/abac/policies', { as: 'admin', body: newPolicy })).status, 409);

    // enforcement is live immediately, no restart
    const kid = { id: 'k1', role: 'user', maxRating: 13 };
    assert.equal(t.abac.can(kid, 'read', 'titles', { rating: 17 }), false);
    assert.equal(t.abac.can(kid, 'read', 'titles', { rating: 10 }), true);

    const put = await t.call('PUT', `/abac/policies/${newPolicy.id}`, { as: 'admin', body: { ...newPolicy, enabled: false } });
    assert.equal(put.status, 200);
    assert.equal(t.abac.can(kid, 'read', 'titles', { rating: 17 }), true, 'disabled -> no longer denies');
    assert.equal((await t.call('PUT', '/abac/policies/nope', { as: 'admin', body: newPolicy })).status, 404);

    const bad = await t.call('POST', '/abac/policies', { as: 'admin', body: { id: 'bad', effect: 'allow', actions: ['reed'], resources: ['*'] } });
    assert.equal(bad.status, 422);
    assert.match(bad.body.details.join(), /unknown action/);
    assert.equal((await t.call('POST', '/abac/policies/validate', { as: 'admin', body: { id: 'v', effect: 'x' } })).status, 422);
    assert.equal((await t.call('POST', '/abac/policies/validate', { as: 'admin', body: { id: 'v', effect: 'allow', actions: ['read'], resources: ['*'] } })).status, 200);

    const chk = await t.call('POST', '/abac/check', { as: 'admin', body: { subject: users.alice, action: 'update', resourceType: 'posts', resource: { createdBy: 'u2' } } });
    assert.equal(chk.body.allowed, false);
    assert.ok(chk.body.trace.length > 0);
    assert.equal((await t.call('POST', '/abac/check', { as: 'admin', body: { subject: users.alice, action: 'zap', resourceType: 'posts' } })).status, 400);

    assert.equal((await t.call('DELETE', `/abac/policies/${newPolicy.id}`, { as: 'admin' })).status, 200);
    assert.equal((await t.call('DELETE', `/abac/policies/${newPolicy.id}`, { as: 'admin' })).status, 404);

    const audit = await t.call('GET', '/abac/audit?limit=100', { as: 'admin' });
    assert.deepEqual(audit.body.entries.filter((e) => e.policyId === newPolicy.id).map((e) => [e.change, e.actor, e.source]),
      [['deleted', 'a1', 'admin-api'], ['updated', 'a1', 'admin-api'], ['created', 'a1', 'admin-api']]);
    const page = await t.call('GET', '/abac/audit?limit=2', { as: 'admin' });
    assert.equal(page.body.entries.length, 2);
    assert.ok(page.body.nextBefore);

    const status = await t.call('GET', '/abac/status', { as: 'admin' });
    assert.equal(status.body.dbSynced, true);
    assert.equal(status.body.writable, true);
  } finally { t.close(); }
});

test('read-only admin API (adminWritable: false) refuses edits but still serves reads', { skip }, async () => {
  const t = await boot({ adminWritable: false });
  try {
    const r = await t.call('POST', '/abac/policies', { as: 'admin', body: { id: 'x', effect: 'allow', actions: ['read'], resources: ['*'] } });
    assert.equal(r.status, 405);
    assert.equal((await t.call('GET', '/abac/policies', { as: 'admin' })).status, 200);
  } finally { t.close(); }
});
