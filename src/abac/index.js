'use strict';
const path = require('path');
const { evaluate } = require('./lib/engine');
const { buildFilter, scope, FilterUnsupportedError } = require('./lib/filter');
const { DEFAULT_ACTIONS, PolicyValidationError, validateDocument } = require('./lib/validate');
const createModels = require('./lib/models');
const { PolicyStore } = require('./lib/store');
const { makeAuthorize, ForbiddenError } = require('./lib/middleware');

/**
 * Create the ABAC instance. Call once at startup, AFTER mongoose is connected.
 *
 * @param {object}   options
 * @param {object}   options.mongoose           your mongoose instance (required)
 * @param {string}   [options.policyFile]       path to policies.json (default: ./policies.json next to this file)
 * @param {string[]} [options.actions]          action vocabulary (default: read, create, update, delete)
 * @param {Function} [options.getSubject]       (req) => subject. Default: req.user
 * @param {Function} [options.getEnv]           (req) => env attributes. Default: { ip, method, now, hour }
 * @param {Function} [options.onDecision]       (request, decision) => void — hook for logging decisions
 * @param {boolean}  [options.watch=true]       hot reload the file when it changes
 * @param {boolean}  [options.reloadOnSighup]   also reload when the process receives SIGHUP
 * @param {number}   [options.reconcileIntervalMs=60000] re-check the DB mirror; 0 disables
 * @param {boolean}  [options.adminWritable=true] false makes the admin API read-only
 * @param {boolean}  [options.exposeReason=false] include why a request was denied in 403 bodies
 * @param {string}   [options.idField='_id']    DB field that `resource.id` maps to in query filters
 * @param {object}   [options.collections]      { policyCollection, auditCollection }
 * @param {object}   [options.logger=console]
 */
async function createAbac(options = {}) {
  const {
    mongoose,
    policyFile = path.join(__dirname, 'policies.json'),
    actions = DEFAULT_ACTIONS,
    getSubject = (req) => req.user,
    getEnv = defaultEnv,
    onDecision,
    watch = true,
    reloadOnSighup = false,
    reconcileIntervalMs = 60000,
    adminWritable = true,
    exposeReason = false,
    idField = '_id',
    collections,
    logger = console,
  } = options;

  if (!mongoose && !options.models) throw new Error('createAbac: pass your mongoose instance as `mongoose`.');

  // `options.models` ({ Policy, Audit }) lets tests inject fakes; normal use passes mongoose.
  const models = options.models || createModels(mongoose, collections);
  const store = new PolicyStore({
    filePath: policyFile,
    models,
    actions,
    logger,
    watch,
    reconcileIntervalMs,
    writable: adminWritable,
  });
  await store.init();

  let sighup;
  if (reloadOnSighup) {
    sighup = () => store.reload({ source: 'sighup', actor: 'system' }).catch((e) => logger.error('[abac]', e.message));
    process.on('SIGHUP', sighup);
  }

  /** Full decision. Throws TypeError for an action that isn't in the vocabulary (a code bug). */
  function check(request, { explain = false, silent = false } = {}) {
    if (!actions.includes(request.action)) {
      throw new TypeError(`Unknown action "${request.action}". Known actions: ${actions.join(', ')}`);
    }
    const decision = evaluate(store.policies, request, { explain });
    if (onDecision && !silent) {
      try { onDecision(request, decision); } catch (e) { logger.error('[abac] onDecision threw:', e.message); }
    }
    return decision;
  }

  /** can(subject, action, resourceType, resource?, env?) -> boolean */
  function can(subject, action, resourceType, resource, env) {
    return check({ subject, action, resourceType, resource, env }).allowed;
  }

  /** Like can(), but throws ForbiddenError (status 403) when denied. */
  function assert(subject, action, resourceType, resource, env) {
    const decision = check({ subject, action, resourceType, resource, env });
    if (!decision.allowed) throw new ForbiddenError(`Not allowed to ${action} ${resourceType}.`, decision);
    return decision;
  }

  /** Mongo filter for what `subject` may `action` on `resourceType`. See lib/filter.js. */
  function filterFor({ subject, action, resourceType, env }) {
    if (!actions.includes(action)) throw new TypeError(`Unknown action "${action}".`);
    return buildFilter(store.policies, { subject, action, resourceType, env }, { idField });
  }

  const authorize = makeAuthorize({ check, filterFor, getSubject, getEnv, exposeReason });

  function adminRouter() {
    // Required lazily so the rest of the module works without express installed.
    // eslint-disable-next-line global-require
    const express = require('express');
    return require('./lib/adminRouter')({ express, store, check, authorize, getSubject, models, actions });
  }

  return {
    check,
    can,
    assert,
    filterFor,
    scope,
    authorize,
    adminRouter,
    reload: (meta) => store.reload({ source: 'manual', actor: 'system', ...meta }),
    store,
    models,
    close() {
      store.close();
      if (sighup) process.removeListener('SIGHUP', sighup);
    },
  };
}

function defaultEnv(req) {
  const now = new Date();
  return { ip: req.ip, method: req.method, now: now.toISOString(), hour: now.getUTCHours() };
}

module.exports = { createAbac, ForbiddenError, PolicyValidationError, FilterUnsupportedError, validateDocument, DEFAULT_ACTIONS };
