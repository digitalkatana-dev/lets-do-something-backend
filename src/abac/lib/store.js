'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');
const { validateDocument, PolicyValidationError } = require('./validate');
const { hashOf, sha256 } = require('./canonical');

/**
 * PolicyStore: the JSON file is the single source of truth.
 *
 *   policies.json --(validate)--> in-memory policies (what the engine enforces)
 *                          \----> MongoDB mirror + audit log
 *
 * - Enforcement always uses the in-memory copy loaded from the file, so a database
 *   outage can never change what is allowed; the DB is a derived mirror.
 * - The DB is diffed against the file on startup, on every file change, and on an
 *   interval. Manual DB edits are overwritten (and audited as drift repair).
 * - An invalid file is rejected: the previous good policies stay active.
 */
class PolicyStore extends EventEmitter {
  constructor({
    filePath,
    models,
    actions,
    logger = console,
    watch = true,
    debounceMs = 200,
    reconcileIntervalMs = 60000,
    writable = true,
  }) {
    super();
    if (!filePath) throw new Error('PolicyStore requires filePath');
    this.filePath = path.resolve(filePath);
    this.models = models;
    this.actions = actions;
    this.logger = logger;
    this.watchEnabled = watch;
    this.debounceMs = debounceMs;
    this.reconcileIntervalMs = reconcileIntervalMs;
    this.writable = writable;

    this._policies = Object.freeze([]);
    this._chain = Promise.resolve();
    this._watcher = null;
    this._debounce = null;
    this._timer = null;
    this._lastRejectedHash = null;

    this.fileHash = null;
    this.loadedAt = null;
    this.dbSynced = false;
    this.lastSyncError = null;
  }

  get policies() {
    return this._policies;
  }

  // ---------- lifecycle ----------

  async init() {
    const result = await this.reload({ source: 'startup', actor: 'system', throwOnInvalid: true });
    if (this.watchEnabled) this._startWatching();
    if (this.reconcileIntervalMs > 0) {
      this._timer = setInterval(() => {
        this.reconcile().catch((err) => this.logger.error('[abac] reconcile failed:', err.message));
      }, this.reconcileIntervalMs);
      this._timer.unref();
    }
    return result;
  }

  close() {
    if (this._watcher) this._watcher.close();
    if (this._debounce) clearTimeout(this._debounce);
    if (this._timer) clearInterval(this._timer);
    this._watcher = this._debounce = this._timer = null;
  }

  // ---------- public operations (serialized) ----------

  /** Re-read the file. No-op when its contents haven't changed and the DB is in sync. */
  reload({ source = 'manual', actor = 'system', throwOnInvalid = false } = {}) {
    return this._enqueue(async () => {
      const text = await fsp.readFile(this.filePath, 'utf8');
      const fileHash = sha256(text);
      if (fileHash === this.fileHash && this.dbSynced) return { changed: false, fileHash };

      let result;
      try {
        result = validateDocument(JSON.parse(text), { actions: this.actions });
      } catch (err) {
        result = { ok: false, errors: [`not valid JSON: ${err.message}`] };
      }

      if (!result.ok) {
        const error = new PolicyValidationError(result.errors);
        if (throwOnInvalid) throw error;
        this.logger.error(`[abac] ${this.filePath} rejected; keeping previous policies.\n${error.message}`);
        this.emit('invalid', error);
        if (fileHash !== this._lastRejectedHash) {
          this._lastRejectedHash = fileHash;
          await this._writeAudit([
            { change: 'rejected', note: result.errors.join('; ').slice(0, 2000), actor, source, fileHash },
          ]).catch((e) => this.logger.error('[abac] could not write audit entry:', e.message));
        }
        return { changed: false, ok: false, errors: result.errors, fileHash };
      }

      this._lastRejectedHash = null;
      return this._apply(result.policies, fileHash, { actor, source });
    });
  }

  /** Re-diff the DB against the in-memory (file) policies. Repairs drift. */
  reconcile() {
    return this._enqueue(async () => {
      if (!this.fileHash) return { changed: false };
      return this._apply(this._policies, this.fileHash, { actor: 'system', source: 'reconcile' }, { swap: false });
    });
  }

  /**
   * Programmatic edit of the JSON file (used by the admin API).
   * fn receives a deep copy of the parsed document; mutate it or return a new one.
   */
  mutate(fn, { actor = 'unknown' } = {}) {
    return this._enqueue(async () => {
      if (!this.writable) {
        const err = new Error('Policies are read-only in this deployment (edit the file and deploy instead).');
        err.code = 'ABAC_READ_ONLY';
        throw err;
      }
      const current = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
      const draft = JSON.parse(JSON.stringify(current));
      const doc = (await fn(draft)) || draft; // fn may mutate `draft` in place or return a new document
      const result = validateDocument(doc, { actions: this.actions });
      if (!result.ok) throw new PolicyValidationError(result.errors);

      const out = `${JSON.stringify(doc, null, 2)}\n`;
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tmp, out, 'utf8');
      await fsp.rename(tmp, this.filePath); // atomic on the same filesystem
      return this._apply(result.policies, sha256(out), { actor, source: 'admin-api' });
    });
  }

  // ---------- internals ----------

  _enqueue(fn) {
    const p = this._chain.then(fn);
    this._chain = p.catch(() => {});
    return p;
  }

  async _apply(policies, fileHash, meta, { swap = true } = {}) {
    if (swap) {
      // The file is the truth: enforce it immediately, even if the DB mirror fails below.
      this._policies = Object.freeze(policies.map((p) => Object.freeze(p)));
      this.fileHash = fileHash;
      this.loadedAt = new Date();
    }
    let changes = [];
    try {
      changes = await this._syncDb(policies, fileHash, meta);
      this.dbSynced = true;
      this.lastSyncError = null;
    } catch (err) {
      this.dbSynced = false;
      this.lastSyncError = err;
      this.logger.error(`[abac] policies loaded from file, but DB mirror/audit failed (will retry): ${err.message}`);
      this.emit('sync-error', err);
    }
    const info = { changed: swap || changes.length > 0, fileHash, policies: policies.length, dbChanges: changes.length };
    if (swap) this.emit('reload', info);
    return info;
  }

  async _syncDb(policies, fileHash, { actor, source }) {
    const { Policy } = this.models;
    const existing = await Policy.find({}).lean();
    const byId = new Map(existing.map((d) => [d.policyId, d]));
    const wanted = new Set(policies.map((p) => p.id));
    const now = new Date();
    const ops = [];
    const audits = [];

    for (const p of policies) {
      const cur = byId.get(p.id);
      const before = cur ? fromDoc(cur) : null;
      if (before && hashOf(before) === hashOf(p)) continue;
      const { id, ...fields } = p;
      ops.push({
        replaceOne: {
          filter: { policyId: id },
          replacement: { policyId: id, ...fields, hash: hashOf(p), syncedAt: now },
          upsert: true,
        },
      });
      audits.push({ policyId: p.id, change: before ? 'updated' : 'created', before, after: p, actor, source, fileHash });
    }
    const removed = [...byId.keys()].filter((id) => !wanted.has(id));
    if (removed.length) {
      ops.push({ deleteMany: { filter: { policyId: { $in: removed } } } });
      for (const id of removed) {
        audits.push({ policyId: id, change: 'deleted', before: fromDoc(byId.get(id)), after: null, actor, source, fileHash });
      }
    }

    if (ops.length) await Policy.bulkWrite(ops, { ordered: true });
    if (audits.length) {
      try {
        await this._writeAudit(audits);
      } catch (err) {
        this.logger.error(`[abac] AUDIT WRITE FAILED for ${audits.length} change(s): ${err.message}`);
        this.emit('audit-error', err, audits);
      }
    }
    return audits;
  }

  async _writeAudit(entries) {
    const at = new Date();
    await this.models.Audit.insertMany(entries.map((e) => ({ at, ...e })));
  }

  _startWatching() {
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath);
    try {
      // Watch the directory: editors and our own writes replace the file via rename.
      this._watcher = fs.watch(dir, { persistent: false }, (_evt, filename) => {
        if (filename && filename !== base) return;
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => {
          this.reload({ source: 'file-watch', actor: 'file' }).catch((err) =>
            this.logger.error('[abac] hot reload failed:', err.message)
          );
        }, this.debounceMs);
      });
      this._watcher.on('error', (err) => this.logger.error('[abac] file watcher error:', err.message));
    } catch (err) {
      this.logger.error(`[abac] could not watch ${dir}; call reload() or send SIGHUP instead:`, err.message);
    }
  }
}

/** DB document -> normalized policy shape (for diffing and audit). */
function fromDoc(d) {
  return {
    id: d.policyId,
    description: d.description || '',
    effect: d.effect,
    enabled: d.enabled !== false,
    actions: [...(d.actions || [])],
    resources: [...(d.resources || [])],
    conditions: (d.conditions || []).map((c) => ({ ...c })),
  };
}

module.exports = { PolicyStore };
