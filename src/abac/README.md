# abac: copy-in ABAC permissions for Express + Mongoose

Drop this folder into any Node/Express project. Policies live in `policies.json`, which is the
**single source of truth**. The file is validated, enforced from memory, mirrored into MongoDB,
and every change is written to an audit collection. Editing the file hot-reloads it, no restart.

- Allow and deny rules, **deny always wins**, **default deny**
- Attributes: `subject.*` (role, id, anything on `req.user`), `resource.*` (e.g. `createdBy`), `env.*`
- Actions: `read`, `create`, `update`, `delete` (configurable)
- Route middleware, a `can()` function, and Mongo query filters for list endpoints
- Admin REST API, itself protected by the same policies
- No dependencies beyond `mongoose` (yours) and `express` (only for the admin router)
- Node 18+, CommonJS (`require` works from ESM projects too)

## Install

1. Copy this folder into your project, e.g. `src/abac/`.
2. Edit `policies.json` for that project.
3. Initialise once, **after** `mongoose.connect()`:

```js
const mongoose = require('mongoose');
const { createAbac } = require('./abac');

await mongoose.connect(process.env.MONGO_URI);
const abac = await createAbac({
  mongoose,
  policyFile: require('path').join(__dirname, 'abac/policies.json'),
  // getSubject: (req) => req.user,        // default; must have at least { id, role }
});
module.exports = abac; // or app.locals.abac = abac
```

`createAbac` refuses to start if `policies.json` is invalid, so you never boot with a broken policy set.

## Use it

```js
const { authorize } = abac;

// List endpoint: only returns what the user may read. Never forgets a check.
app.get('/posts', authenticate, authorize('read', 'posts', { filter: true }), async (req, res) => {
  const posts = await Post.find(req.abac.scope({ status: 'published' })); // ANDs your query with the permission filter
  res.json(posts);
});

// Single document: loads it, checks resource.createdBy etc., exposes it as req.abac.resource.
app.put('/posts/:id', authenticate, authorize('update', 'posts', { load: { model: Post } }), async (req, res) => {
  const { title, body } = req.body; // whitelist fields; see "Mass assignment" below
  const post = await Post.findByIdAndUpdate(req.params.id, { title, body }, { new: true });
  res.json(post);
});

// Create: nothing to load. Add `resource: (req) => req.body` if rules depend on attributes of the new doc.
app.post('/posts', authenticate, authorize('create', 'posts'), async (req, res) => {
  const post = await Post.create({ ...req.body, createdBy: req.user.id });
  res.status(201).json(post);
});

// Anywhere in code (services, jobs, sockets):
if (!abac.can(user, 'delete', 'posts', post)) { /* ... */ }
abac.assert(user, 'delete', 'posts', post);       // throws ForbiddenError (status 403)
abac.check({ subject, action, resourceType, resource }, { explain: true }); // full decision + trace

// Admin API (admin/superAdmin only by default policy):
app.use('/admin/abac', authenticate, abac.adminRouter());
```

`authenticate` is your existing auth middleware that sets `req.user`. Responses: **401** no user,
**403** denied, **404** `load` found nothing (`onMissing: 403` to avoid revealing which ids exist).

## Policy file

```json
{
  "version": 1,
  "policies": [
    {
      "id": "owners-update-delete-own",
      "description": "Users can update or delete only what they created.",
      "effect": "allow",
      "actions": ["update", "delete"],
      "resources": ["*"],
      "conditions": [
        { "attr": "resource.createdBy", "op": "eq", "valueFrom": "subject.id" }
      ]
    }
  ]
}
```

| Field | Notes |
|---|---|
| `id` | Unique. Letters, digits, `. _ : -` |
| `effect` | `allow` or `deny` |
| `actions` | Any of your actions, or `"*"` |
| `resources` | Resource type names you pass to `authorize()` / `can()`, or `"*"`. Not Mongo collection names, just labels. |
| `enabled` | Optional, default `true`. Handy to switch a rule off without deleting it. |
| `conditions` | Optional. **All** must pass (AND). For OR, write two policies. |

A condition is `{ attr, op, value }` or `{ attr, op, valueFrom }`:

- `attr`: `subject.x`, `resource.x`, or `env.x` (dot paths allowed, e.g. `subject.plan.tier`). `env` has `ip`, `method`, `now` (ISO), `hour` (UTC); override with `getEnv`.
- `op`: `eq` `ne` `in` `nin` `gt` `gte` `lt` `lte` `exists` `contains` (array membership)
- `value` is a literal; `valueFrom` reads another attribute (e.g. `subject.id`). `exists` takes `value: true|false`.
- If the attribute is an array (e.g. `role: ["user","editor"]`), `eq`/`in` match when **any** element matches; `ne`/`nin` when **none** do.
- ObjectIds and Dates are compared as strings; there is no type coercion (`"10"` is not `10`).

Typos are caught at load: unknown keys, unknown actions, bad operators and duplicate ids are all rejected.

### Decision rules

1. Any applicable **deny** wins. 2. Otherwise any applicable **allow** permits. 3. Otherwise **deny**.
4. If a `valueFrom` attribute is missing (e.g. `subject.id` undefined), the condition counts as *false* for allow rules and *true* for deny rules, so missing data can never grant access.

The shipped `policies.json` encodes: admin/superAdmin do everything; any signed-in subject can read and create;
users can update/delete only where `resource.createdBy == subject.id`; suspended subjects are denied everything;
the admin API is admin-only. **Review the `authenticated-read-create` rule**: it lets every signed-in user read every resource type.
Narrow `resources` per project as needed.

## Single source of truth, DB mirror, hot reload, audit

```
policies.json ──validate──▶ in-memory policies  ◀── what the engine enforces
      │                         │
      └─────────────────────────┴──▶ MongoDB  abac_policies (mirror) + abac_audit (change log)
```

- **Enforcement uses the file's policies in memory**, so a database outage cannot change what is allowed. The DB copy is derived.
- **Sync** happens at startup, on every file change (`fs.watch`, debounced), on `abac.reload()`, optionally on `SIGHUP`
  (`reloadOnSighup: true`), and every 60 s (`reconcileIntervalMs`) to heal DB drift. If the DB is down, the app keeps running and retries.
- **Manual edits to the DB are overwritten** (and audited as `source: "reconcile"`). Edit the file or use the admin API.
- **Invalid edits are rejected**: the previous good policies stay active, an `invalid` event fires, and a `rejected` audit entry records why.
- **Audit entries** (`abac_audit`): `at, policyId, change (created|updated|deleted|rejected), before, after, actor, source, fileHash, note`.
  `source` is `startup | file-watch | admin-api | reconcile | sighup | manual`. `actor` is the user id for admin-API edits, `file` for file edits.
  Changes made while the app was down show up at the next startup.
- Docker bind mounts and some network filesystems don't deliver file events. If hot reload doesn't fire there, use `reloadOnSighup` or `POST /reload`.

## Admin API

Mounted wherever you choose. Guarded by resource types `abac-policies` and `abac-audit`
(GET→read, POST→create, PUT→update, DELETE→delete).

| Method & path | Purpose |
|---|---|
| `GET /status` | file hash, loaded-at, policy count, DB sync health |
| `GET /policies`, `GET /policies/:id` | current policies |
| `POST /policies` | add a policy (409 if the id exists) |
| `PUT /policies/:id` | replace a policy |
| `DELETE /policies/:id` | remove a policy |
| `POST /policies/validate` | dry-run validation of one policy |
| `POST /check` | `{subject, action, resourceType, resource?, env?}` → decision with per-policy trace. Nothing is changed. |
| `POST /reload` | re-read the file now |
| `GET /audit?policyId=&limit=&before=` | newest first; pass `nextBefore` as `before` to page |

Edits are written to `policies.json` (atomically) and then synced, so the file stays the truth.
Pass `adminWritable: false` to make the API read-only.

## Things to know

- **Multiple server instances**: each instance watches *its own* copy of the file. An admin-API edit changes the file only on the instance that handled it.
  For multi-instance or immutable-container deployments, set `adminWritable: false`, change policies in git, and deploy.
  (Or point `policyFile` at a shared volume.)
- **Mass assignment**: ABAC decides *whether* a user may update a document, not *which fields* they may set.
  Set `createdBy` from `req.user` on create, and strip `createdBy` (and any role fields) from update bodies.
- **Query filters** cannot express a rule that compares two `resource.*` attributes (`FilterUnsupportedError`);
  use `can()` per document for those. With Mongoose, string ids in the filter are cast to ObjectId per your schema.
- **Concurrent admin edits** are serialized per process; there is no optimistic-locking token across editors.
- Decisions are not cached (not needed: evaluation is in-memory). `onDecision(request, decision)` lets you log them.
- Multi-tenancy isn't built in. To add it later, give users and resources a `tenantId` and add a deny rule:
  `resource.tenantId ne valueFrom subject.tenantId`.

## Tests

```
npm test                         # node:test, no extra dependencies
MONGO_URI=... npm test           # also runs the real-MongoDB integration test (use a throwaway database)
```

Covered: engine semantics, validation, filter-vs-engine equivalence across many subject/resource combinations, hot reload,
audit, DB outage and drift repair, the HTTP middleware, and the admin API. The HTTP and model tests need `express` / `mongoose`
installed (they are, in your project) and skip themselves otherwise.
