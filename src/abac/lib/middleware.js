'use strict';
const { scope } = require('./filter');

class ForbiddenError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = 'ForbiddenError';
    this.status = 403;
    this.decision = decision;
  }
}

async function loadResource(load, req) {
  if (typeof load === 'function') return load(req);
  const { model, param = 'id', field = '_id' } = load;
  try {
    return await model.findOne({ [field]: req.params[param] }).lean();
  } catch (err) {
    if (err && err.name === 'CastError') return null; // malformed id -> not found
    throw err;
  }
}

/**
 * Builds the `authorize(action, resourceType, options)` Express middleware factory.
 *
 * options:
 *   load:     { model, param = 'id', field = '_id' } | async (req) => doc
 *             Loads the target document so rules can use resource.* attributes
 *             (e.g. resource.createdBy). Result is exposed as req.abac.resource.
 *   resource: (req) => object — describe a resource that isn't in the DB yet (create).
 *   filter:   true — for list endpoints; sets req.abac.filter / req.abac.scope(query).
 *   onMissing: 404 (default) | 403 — response when `load` finds nothing.
 *   anonymous: true — for public routes. Instead of 401, a caller with no subject is evaluated as
 *             { role: 'anonymous' }, so a policy decides whether anonymous access is allowed.
 */
function makeAuthorize({ check, filterFor, getSubject, getEnv, exposeReason = false }) {
  return function authorize(action, resourceType, options = {}) {
    const { load, resource: describe, filter: wantFilter = false, onMissing = 404, anonymous = false } = options;

    return async function abacAuthorize(req, res, next) {
      try {
        let subject = getSubject(req);
        if (!subject) {
          if (!anonymous) return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
          subject = { role: 'anonymous' };
        }
        const env = getEnv(req);
        const denied = (decision) => {
          const body = { error: 'Forbidden', message: `You do not have permission to ${action} ${resourceType}.` };
          if (exposeReason) body.decision = { reason: decision.reason, deny: decision.deny, allow: decision.allow };
          return res.status(403).json(body);
        };

        if (wantFilter) {
          const result = filterFor({ subject, action, resourceType, env });
          if (result.mode === 'none') return denied({ reason: 'default-deny', allow: [], deny: [] });
          req.abac = { filter: result.filter, scope: (query) => scope(result.filter, query), subject, env };
          return next();
        }

        let resource;
        if (load) {
          resource = await loadResource(load, req);
          if (!resource) {
            return res.status(onMissing).json(
              onMissing === 404
                ? { error: 'Not Found', message: `${resourceType} not found.` }
                : { error: 'Forbidden', message: `You do not have permission to ${action} ${resourceType}.` }
            );
          }
        } else if (describe) {
          resource = await describe(req);
        }

        const decision = check({ subject, action, resourceType, resource, env });
        if (!decision.allowed) return denied(decision);

        req.abac = { decision, resource, subject, env };
        return next();
      } catch (err) {
        return next(err);
      }
    };
  };
}

module.exports = { makeAuthorize, ForbiddenError };
