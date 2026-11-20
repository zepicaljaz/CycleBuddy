// Small request-safety helpers for the account server. Kept apart from
// index.js so they can be tested without MongoDB or a listening server.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

// ---- Passwords

/** scrypt cost for new hashes. 128 * N * r bytes = 32 MiB, so maxmem must be above that. */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;
const PREFIX = 's2';

function scryptAsync(password, salt, options) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** A new password hash: `s2$<salt>$<hash>` (hex), scrypt N=2^15, r=8, p=1. */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, SCRYPT)).toString('hex');
  return `${PREFIX}$${salt}$${hash}`;
}

/**
 * Checks a password against a stored hash. Understands the current `s2$salt$hash`
 * format and the old `salt:hash` one (scrypt defaults, N=2^14). `rehash` is true when
 * the password was right but the stored hash uses the old format.
 */
export async function verifyPassword(password, stored) {
  const value = String(stored ?? '');
  let salt;
  let hash;
  let options;
  let rehash = false;
  if (value.startsWith(`${PREFIX}$`)) {
    [, salt, hash] = value.split('$');
    options = SCRYPT;
  } else {
    [salt, hash] = value.split(':');
    options = {};
    rehash = true;
  }
  if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash)) return { ok: false, rehash: false };
  const next = await scryptAsync(password, salt, options);
  const prev = Buffer.from(hash, 'hex');
  if (next.length !== prev.length || !timingSafeEqual(next, prev)) return { ok: false, rehash: false };
  return { ok: true, rehash };
}

let dummyHash = null;
/** A hash of a random password, so a missing account costs the same time as a wrong password. */
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

// ---- Rate limits

/**
 * Fixed-window counter per key. `hit(key)` counts one attempt and returns false
 * once the key went over `limit` in the current window.
 */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    hit(key) {
      const t = now();
      let entry = hits.get(key);
      if (!entry || t >= entry.resetAt) {
        entry = { count: 0, resetAt: t + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return entry.count <= limit;
    },
    prune() {
      const t = now();
      for (const [key, entry] of hits) if (t >= entry.resetAt) hits.delete(key);
    },
    get size() {
      return hits.size;
    },
  };
}

// ---- Origin / CSRF

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLoopbackHost(host) {
  try {
    return LOOPBACK.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/**
 * True when a state-changing request may proceed. Requests without an Origin
 * header (curl, server-to-server) are allowed; browsers always send one on
 * cross-site POST/PUT/DELETE. Outside production any localhost origin is fine,
 * so the Vite dev proxy (Origin http://localhost:5173, Host 127.0.0.1:8787) works.
 */
export function originAllowed(req, { production, appOrigin }) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === 'null') return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const host = req.headers.host || '';
  const allowed = new Set();
  if (appOrigin) {
    for (const item of appOrigin.split(',')) {
      if (item.trim()) allowed.add(item.trim().replace(/\/$/, ''));
    }
  } else if (host) {
    allowed.add(`${production ? 'https' : 'http'}://${host}`);
  }
  // `npm start` on this computer: plain http on localhost.
  if (host && isLoopbackHost(host)) allowed.add(`http://${host}`);
  if (allowed.has(parsed.origin)) return true;
  return !production && LOOPBACK.has(parsed.hostname);
}

// ---- Request bodies

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function hasBody(req) {
  const length = req.headers['content-length'];
  if (length !== undefined) return Number(length) > 0;
  return req.headers['transfer-encoding'] !== undefined;
}

export function isJson(req) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

/**
 * Reads a JSON object body. 415 when the body is not application/json, 413 when it
 * is over `max` (the rest of the body is drained so the client sees the 413), 400
 * when it is not a plain JSON object.
 */
export function readBody(req, max = 20_000) {
  return new Promise((resolve, reject) => {
    if (!hasBody(req)) {
      req.resume();
      resolve({});
      return;
    }
    if (!isJson(req)) {
      req.resume();
      reject(httpError(415, 'Send the request as JSON.', { close: true }));
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) {
      drain(req, max);
      reject(httpError(413, 'Request is too large.', { close: true }));
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > max) {
        done = true;
        chunks.length = 0;
        drain(req, max);
        reject(httpError(413, 'Request is too large.', { close: true }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reject(httpError(400, 'The request was not valid.'));
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(httpError(400, 'The request was not valid.'));
        return;
      }
      resolve(parsed);
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

/** Read and drop the rest of an oversized body. A client that keeps sending far past the limit is cut off. */
function drain(req, max) {
  let extra = 0;
  const cap = Math.max(max * 2, 1_000_000);
  req.on('data', (chunk) => {
    extra += chunk.length;
    if (extra > cap) req.destroy();
  });
  req.resume();
}

// ---- Cookies

/** The raw value of one cookie, or null. A badly encoded value counts as missing. */
export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

// ---- Static files

/** The file under `dist` for a URL path, or null when it would leave `dist` (including sibling folders like dist-old). */
export function staticPath(dist, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const base = path.resolve(dist);
  const file = path.resolve(base, `.${path.posix.sep}${rel}`);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}
