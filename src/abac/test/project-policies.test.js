'use strict';
/**
 * Tests the rules written in ../policies.json (the project's real policy file).
 * These are the business rules in plain terms; update them if you change the policies.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { evaluate } = require('../lib/engine');
const { buildFilter } = require('../lib/filter');
const { validateDocument, DEFAULT_ACTIONS } = require('../lib/validate');

const ACTIONS = [...DEFAULT_ACTIONS, 'rsvp'];
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'policies.json'), 'utf8'));
const compile = (doc) => {
  const r = validateDocument(doc, { actions: ACTIONS });
  assert.ok(r.ok, r.errors.join('\n'));
  return r.policies;
};
const POLICIES = compile(raw);

const can = (subject, action, resourceType, resource, policies = POLICIES) =>
  evaluate(policies, { subject, action, resourceType, resource }).allowed;

// Subjects as built by src/permissions.js: id = Profile._id, identifiers = [id, email, phone]
const mk = (id, role, email, phone) => ({ id, role, identifiers: [id, email, phone].filter(Boolean) });
const superAdmin = mk('s1', 'superAdmin', 'root@x.com');
const admin = mk('a1', 'admin', 'admin@x.com');
const alice = mk('p1', 'user', 'alice@x.com', '5551110000');
const bob = mk('p2', 'user', 'bob@x.com');
const carol = mk('p3', 'user', 'carol@x.com', '5553330000');
const anon = { role: 'anonymous' };
const oid = (hex) => ({ _bsontype: 'ObjectId', toString: () => hex });

test('policy file is valid', () => {
  assert.ok(POLICIES.length > 0);
});

test('memories: anyone can view, only the creator / admin / superAdmin can delete or edit', () => {
  const memory = { createdBy: oid('p1') }; // ObjectId from the DB vs string id in the subject
  for (const who of [alice, bob, carol, admin, superAdmin, anon]) assert.equal(can(who, 'read', 'memories', memory), true, `read by ${who.role}`);
  for (const action of ['delete', 'update']) {
    assert.equal(can(alice, action, 'memories', memory), true, `creator ${action}`);
    assert.equal(can(bob, action, 'memories', memory), false, `other user ${action}`);
    assert.equal(can(anon, action, 'memories', memory), false, `anonymous ${action}`);
    assert.equal(can(admin, action, 'memories', memory), true, `admin ${action}`);
    assert.equal(can(superAdmin, action, 'memories', memory), true, `superAdmin ${action}`);
  }
  assert.equal(can(alice, 'create', 'memories'), true);
  assert.equal(can(anon, 'create', 'memories'), false);
});

test('private events: only invited users can RSVP (by profile id, email or phone)', () => {
  const event = {
    isPublic: false, createdBy: 'p2',
    invitedGuests: [
      { firstName: 'Bob' }, // the host entry has no _id
      { _id: oid('p1') }, // invited by profile id (ObjectId in the DB)
      { _id: 'dave@x.com', email: 'dave@x.com' }, // invited by email before signing up
      { _id: '5553330000', phone: '5553330000' }, // invited by phone
    ],
  };
  assert.equal(can(alice, 'rsvp', 'events', event), true, 'invited by profile id');
  assert.equal(can(carol, 'rsvp', 'events', event), true, 'invited by phone');
  assert.equal(can(mk('p9', 'user', 'dave@x.com'), 'rsvp', 'events', event), true, 'invited by email');
  assert.equal(can(mk('p8', 'user', 'eve@x.com'), 'rsvp', 'events', event), false, 'not invited');
  assert.equal(can(anon, 'rsvp', 'events', event), false, 'anonymous');
  assert.equal(can(bob, 'rsvp', 'events', event), true, 'host');
  assert.equal(can(admin, 'rsvp', 'events', event), true, 'admin');
  assert.equal(can(alice, 'rsvp', 'events', { ...event, invitedGuests: [] }), false, 'nobody invited');
  assert.equal(can(alice, 'rsvp', 'events', { ...event, invitedGuests: undefined }), false, 'no guest list');
});

test('public events: any signed-in user can RSVP; anonymous cannot', () => {
  const event = { isPublic: true, createdBy: 'p2', invitedGuests: [] };
  for (const who of [alice, bob, carol, admin]) assert.equal(can(who, 'rsvp', 'events', event), true, who.role);
  assert.equal(can(anon, 'rsvp', 'events', event), false);
});

test('RSVP rights do not grant edit/delete on the event', () => {
  const event = { isPublic: true, createdBy: 'p2', invitedGuests: [{ _id: 'p1' }] };
  for (const action of ['update', 'delete']) {
    assert.equal(can(alice, action, 'events', event), false, `invited guest ${action}`);
    assert.equal(can(carol, action, 'events', event), false, `public attendee ${action}`);
    assert.equal(can(bob, action, 'events', event), true, `host ${action}`);
    assert.equal(can(admin, action, 'events', event), true, `admin ${action}`);
  }
});

test('events: signed-in users can create; reading stays open', () => {
  assert.equal(can(alice, 'create', 'events'), true);
  assert.equal(can(anon, 'create', 'events'), false);
  assert.equal(can(anon, 'read', 'events', { isPublic: false }), true, 'mirrors current open GET /events');
});

test('profiles: signed-in read, own update/delete, admin anything, roles are admin-only', () => {
  const aliceProfile = { _id: 'p1', role: 'user' };
  assert.equal(can(bob, 'read', 'profiles', aliceProfile), true);
  assert.equal(can(anon, 'read', 'profiles', aliceProfile), false);
  for (const action of ['update', 'delete']) {
    assert.equal(can(alice, action, 'profiles', aliceProfile), true, `own ${action}`);
    assert.equal(can(bob, action, 'profiles', aliceProfile), false, `other ${action}`);
    assert.equal(can(admin, action, 'profiles', aliceProfile), true, `admin ${action}`);
  }
  assert.equal(can(alice, 'update', 'profile-roles', aliceProfile), false, 'users cannot change their own role');
  assert.equal(can(admin, 'update', 'profile-roles', aliceProfile), true);
  assert.equal(can(superAdmin, 'update', 'profile-roles', aliceProfile), true);
});

test('notifications: filter restricts users to their own, admins/anonymous handled', () => {
  const f = (subject) => buildFilter(POLICIES, { subject, action: 'read', resourceType: 'notifications' });
  assert.deepEqual(f(alice), { mode: 'filter', filter: { userTo: 'p1' } });
  assert.equal(f(anon).mode, 'none');
  assert.equal(f(admin).mode, 'all'); // routes still add their own userTo so admins see only theirs
});

test('uploads and the permission admin API are admin-only', () => {
  assert.equal(can(alice, 'delete', 'assets', {}), false);
  assert.equal(can(anon, 'delete', 'assets', {}), false);
  assert.equal(can(admin, 'delete', 'assets', {}), true);
  assert.equal(can(alice, 'read', 'abac-policies'), false);
  assert.equal(can(anon, 'read', 'abac-audit'), false);
  assert.equal(can(superAdmin, 'update', 'abac-policies'), true);
});

test('unknown resource types are denied to everyone but admins (default deny)', () => {
  assert.equal(can(alice, 'read', 'something-new', {}), false);
  assert.equal(can(anon, 'read', 'something-new', {}), false);
  assert.equal(can(admin, 'read', 'something-new', {}), true);
});

test('optional policies: rsvpOpen and superAdmin protection are off, and work when enabled', () => {
  const closed = { isPublic: true, rsvpOpen: false, createdBy: 'p2', invitedGuests: [] };
  assert.equal(can(alice, 'rsvp', 'events', closed), true, 'disabled by default');

  const enabled = compile({ ...raw, policies: raw.policies.map((p) => ({ ...p, enabled: true })) });
  assert.equal(can(alice, 'rsvp', 'events', closed, enabled), false, 'closed RSVP blocks users');
  assert.equal(can(admin, 'rsvp', 'events', closed, enabled), false, 'and admins (deny wins)');
  assert.equal(can(alice, 'rsvp', 'events', { ...closed, rsvpOpen: true }, enabled), true);

  const rootProfile = { _id: 's1', role: 'superAdmin' };
  assert.equal(can(admin, 'delete', 'profiles', rootProfile), true, 'disabled by default: admins have full control');
  assert.equal(can(admin, 'delete', 'profiles', rootProfile, enabled), false, 'enabled: admins cannot delete a superAdmin');
  assert.equal(can(superAdmin, 'update', 'profiles', rootProfile, enabled), true, 'superAdmin can edit themself');
});
