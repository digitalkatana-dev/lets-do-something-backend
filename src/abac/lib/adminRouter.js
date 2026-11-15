'use strict';
const { PolicyValidationError, validateDocument } = require('./validate');

const POLICIES = 'abac-policies';
const AUDIT = 'abac-audit';

/**
 * REST API to inspect, edit, dry-run and audit policies. Every route is itself guarded
 * by the permission system on the resource types "abac-policies" and "abac-audit":
 *   GET -> read, POST create -> create, PUT -> update, DELETE -> delete.
 * Edits are written to the JSON file (the source of truth), then synced to the DB.
 */
module.exports = function buildAdminRouter({ express, store, check, authorize, getSubject, models, actions }) {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const actorOf = (req) => {
    const s = getSubject(req) || {};
    return String(s.id ?? s._id ?? 'unknown');
  };

  router.get('/status', authorize('read', POLICIES), (req, res) => {
    res.json({
      fileHash: store.fileHash,
      loadedAt: store.loadedAt,
      policyCount: store.policies.length,
      dbSynced: store.dbSynced,
      lastSyncError: store.lastSyncError ? store.lastSyncError.message : null,
      writable: store.writable,
    });
  });

  router.get('/policies', authorize('read', POLICIES), (req, res) => {
    res.json({ fileHash: store.fileHash, loadedAt: store.loadedAt, policies: store.policies });
  });

  router.get('/policies/:id', authorize('read', POLICIES), (req, res) => {
    const policy = store.policies.find((p) => p.id === req.params.id);
    if (!policy) return res.status(404).json({ error: 'Not Found' });
    res.json(policy);
  });

  router.post('/policies/validate', authorize('read', POLICIES), (req, res) => {
    const result = validateDocument({ version: 1, policies: [req.body] }, { actions });
    res.status(result.ok ? 200 : 422).json({ ok: result.ok, errors: result.errors });
  });

  router.post('/policies', authorize('create', POLICIES), wrap(async (req, res) => {
    const body = req.body;
    const info = await store.mutate((doc) => {
      if (doc.policies.some((p) => p.id === body.id)) {
        const err = new Error(`Policy "${body.id}" already exists`);
        err.status = 409;
        throw err;
      }
      doc.policies.push(body);
    }, { actor: actorOf(req) });
    res.status(201).json({ ok: true, ...info });
  }));

  router.put('/policies/:id', authorize('update', POLICIES), wrap(async (req, res) => {
    const body = { ...req.body, id: req.params.id };
    const info = await store.mutate((doc) => {
      const i = doc.policies.findIndex((p) => p.id === req.params.id);
      if (i === -1) {
        const err = new Error(`Policy "${req.params.id}" not found`);
        err.status = 404;
        throw err;
      }
      doc.policies[i] = body;
    }, { actor: actorOf(req) });
    res.json({ ok: true, ...info });
  }));

  router.delete('/policies/:id', authorize('delete', POLICIES), wrap(async (req, res) => {
    const info = await store.mutate((doc) => {
      const i = doc.policies.findIndex((p) => p.id === req.params.id);
      if (i === -1) {
        const err = new Error(`Policy "${req.params.id}" not found`);
        err.status = 404;
        throw err;
      }
      doc.policies.splice(i, 1);
    }, { actor: actorOf(req) });
    res.json({ ok: true, ...info });
  }));

  // Dry run: "would this request be allowed, and why?" Nothing is changed or logged.
  router.post('/check', authorize('read', POLICIES), (req, res) => {
    const { subject, action, resourceType, resource, env } = req.body || {};
    if (!subject || !action || !resourceType) {
      return res.status(400).json({ error: 'Bad Request', message: 'subject, action and resourceType are required.' });
    }
    try {
      res.json(check({ subject, action, resourceType, resource, env }, { explain: true, silent: true }));
    } catch (err) {
      res.status(400).json({ error: 'Bad Request', message: err.message });
    }
  });

  router.post('/reload', authorize('update', POLICIES), wrap(async (req, res) => {
    const info = await store.reload({ source: 'admin-api', actor: actorOf(req) });
    res.status(info.ok === false ? 422 : 200).json(info);
  }));

  router.get('/audit', authorize('read', AUDIT), wrap(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const query = {};
    if (req.query.policyId) query.policyId = String(req.query.policyId);
    if (req.query.before) query._id = { $lt: String(req.query.before) };
    let entries;
    try {
      entries = await models.Audit.find(query).sort({ _id: -1 }).limit(limit).lean();
    } catch (err) {
      if (err.name === 'CastError') return res.status(400).json({ error: 'Bad Request', message: 'Invalid "before" cursor.' });
      throw err;
    }
    res.json({ entries, nextBefore: entries.length === limit ? entries[entries.length - 1]._id : null });
  }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof PolicyValidationError) return res.status(422).json({ error: 'Invalid policy', details: err.errors });
    if (err.code === 'ABAC_READ_ONLY') return res.status(405).json({ error: 'Read-only', message: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    return next(err);
  });

  return router;
};
