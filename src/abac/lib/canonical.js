'use strict';
const crypto = require('crypto');

/** Recursively sort object keys so equal policies always serialize identically. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (value[k] !== undefined) out[k] = canonicalize(value[k]);
    }
    return out;
  }
  return value;
}

const stableStringify = (v) => JSON.stringify(canonicalize(v));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashOf = (v) => sha256(stableStringify(v));

module.exports = { canonicalize, stableStringify, sha256, hashOf };
