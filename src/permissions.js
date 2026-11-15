const mongoose = require('mongoose');
const path = require('path');
const { createAbac, DEFAULT_ACTIONS } = require('./abac');
const requireAuth = require('./middleware/requireAuth');

/**
 * App-side wrapper around ./abac.
 *
 * Routes are required before the database connects, but ABAC has to load its
 * policies after it connects. So routes call `authorize(...)` here at require
 * time, and the real middleware is created lazily on the first request.
 * Until `init()` has finished, protected routes answer 503.
 */

let abac = null;
let initPromise = null;
let adminRouter = null;

// The subject is the signed-in user's *Profile* (role and ownership live there).
// requireAuth sets req.profile.
const getSubject = (req) => {
  const profile = req?.profile;
  if (!profile) return null;

  return {
    id: profile._id,
    role: profile.role,
    userId: req.user?._id,
    email: profile.email,
    phone: profile.phone,
    // Anything an invitedGuests entry might use as its _id.
    identifiers: [String(profile._id), profile.email, profile.phone].filter(
      Boolean,
    ),
  };
};

const init = () => {
  if (!initPromise) {
    initPromise = createAbac({
      mongoose,
      policyFile: path.join(__dirname, 'abac', 'policies.json'),
      actions: [...DEFAULT_ACTIONS, 'rsvp'],
      getSubject,
      // In production the policy file is part of the deploy; edit it and redeploy.
      // Locally, the admin API may rewrite it.
      adminWritable: process.env.NODE_ENV !== 'production',
      onDecision: (request, decision) => {
        if (!decision.allowed && process.env.ABAC_LOG_DENIALS === 'true') {
          console.log(
            `[abac] DENIED ${request.action} ${request.resourceType} for ${request.subject?.role}/${request.subject?.id} (${decision.reason})`,
          );
        }
      },
    }).then((instance) => {
      abac = instance;
      return instance;
    });
  }
  return initPromise;
};

const starting = (res) =>
  res.status(503).json({ error: 'Service is starting, please retry.' });

// Same arguments as abac.authorize(action, resourceType, options)
const authorize = (...args) => {
  let middleware;
  return (req, res, next) => {
    if (!abac) return starting(res);
    middleware = middleware || abac.authorize(...args);
    return middleware(req, res, next);
  };
};

// Sign-in check + permission check in one: router.put('/x', protect(...), handler)
const protect = (...args) => [requireAuth, authorize(...args)];

// app.use('/api/abac', requireAuth, permissions.adminRouter)
const adminRouterMiddleware = (req, res, next) => {
  if (!abac) return starting(res);
  adminRouter = adminRouter || abac.adminRouter();
  return adminRouter(req, res, next);
};

const ready = () => {
  if (!abac) throw new Error('Permissions are not initialised yet.');
  return abac;
};

module.exports = {
  init,
  authorize,
  protect,
  adminRouter: adminRouterMiddleware,
  getSubject,
  can: (...args) => ready().can(...args),
  check: (...args) => ready().check(...args),
  assert: (...args) => ready().assert(...args),
};
