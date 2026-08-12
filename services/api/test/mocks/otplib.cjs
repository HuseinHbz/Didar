// Jest-only stand-in for the `otplib` package (see test/jest-e2e.json's
// `moduleNameMapper`, which redirects `otplib` here). NOT a fake/no-op
// mock — the actual TOTP algorithm below is the real `@otplib/*`
// implementation (@otplib/core, @otplib/totp, @otplib/uri — all
// dependency-free, pure CJS). Only the two *plugins* those packages expect
// to be handed (base32 codec, HMAC/random-bytes crypto) are swapped for
// hand-written equivalents built on Node's own `crypto`, in place of
// `@otplib/plugin-base32-scure` and `@otplib/plugin-crypto-noble`.
//
// Why this exists: those two real plugins transitively depend on
// `@scure/base` and `@noble/hashes`, both pure ESM with no CommonJS build
// at all. Node 22's `require()` can load synchronous ESM directly — which
// is why the actual running app (`nest build` + `node dist/main.js`) and a
// plain `node -e` script both use the real `otplib` (plugins included)
// successfully — but Jest's own CommonJS module loader has no equivalent
// and fails outright with "Unexpected token 'export'"/"Cannot use import
// statement outside a module" trying to parse those packages as CJS. This
// file changes nothing about what ships to production; it only lets `jest
// --config test/jest-e2e.json` resolve `import ... from 'otplib'`
// (services/api's infrastructure/crypto/totp.service.ts) at all. If this
// stops being necessary once Jest/ts-jest supports Node's require(esm),
// delete this file and the moduleNameMapper entry together.

const crypto = require('node:crypto');
const path = require('node:path');

function resolveFromOtplib(pkg) {
  const otplibDir = path.dirname(require.resolve('otplib'));
  return require(require.resolve(pkg, { paths: [otplibDir] }));
}

// Dependency-free otplib packages — no ESM anywhere in this subtree, safe
// to require directly under Jest.
const core = resolveFromOtplib('@otplib/core');
const totpImpl = resolveFromOtplib('@otplib/totp');
const uriImpl = resolveFromOtplib('@otplib/uri');

// RFC 4648 base32, no padding — same shape @otplib/plugin-base32-scure
// provides by wrapping @scure/base.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

const base32 = core.createBase32Plugin({
  name: 'node-crypto-test-stub',
  encode: base32Encode,
  decode: base32Decode,
});

// HMAC-SHA1/256/512 + CSPRNG via Node's built-in `crypto` — same shape
// @otplib/plugin-crypto-noble provides by wrapping @noble/hashes.
const nodeCrypto = core.createCryptoPlugin({
  name: 'node-crypto-test-stub',
  hmac: (algorithm, key, message) => crypto.createHmac(algorithm, key).update(message).digest(),
  randomBytes: (length) => crypto.randomBytes(length),
});

function withTotpDefaults(options) {
  return {
    crypto: nodeCrypto,
    base32,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    epoch: Math.floor(Date.now() / 1000),
    t0: 0,
    epochTolerance: 0,
    guardrails: core.createGuardrails(),
    ...options,
  };
}

module.exports = {
  generateSecret: (options = {}) =>
    core.generateSecret({ crypto: nodeCrypto, base32, length: 20, ...options }),
  generate: (options) => totpImpl.generate(withTotpDefaults(options)),
  verify: (options) => totpImpl.verify(withTotpDefaults(options)),
  generateURI: (options) =>
    uriImpl.generateTOTP({ algorithm: 'sha1', digits: 6, period: 30, ...options }),
};
