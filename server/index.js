import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Binary, MongoClient } from 'mongodb';
import { cleanProfile, mergeProfiles } from './profile.js';
import { createRateLimiter, dummyPasswordHash, hashPassword, hasBody, isJson, originAllowed, readBody, readCookie, staticPath, verifyPassword } from './security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(root, 'dist');

loadEnv(path.join(root, '.env'));

const port = Number(process.env.PORT) || 8787;
const production = process.env.NODE_ENV === 'production';
const dbName = process.env.MONGODB_DB || 'cyclebuddy';
const sessionSecret = process.env.SESSION_SECRET || '';
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const appOrigin = process.env.APP_ORIGIN?.trim() || '';
const cookieName = 'cb_session';
const sessionDays = 30;

/** @type {import('mongodb').Db | null} */
let db = null;
let accountMessage = '';

function loadEnv(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const MONGO_RETRY_MS = 10_000;

async function connectMongo() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    accountMessage = 'Add your MongoDB connection string to .env as MONGODB_URI, then restart the app.';
    console.log('MongoDB: not configured');
    return;
  }
  if (!sessionSecret) {
    accountMessage = 'Add SESSION_SECRET to .env, then restart the app.';
    console.log('MongoDB: SESSION_SECRET is missing');
    return;
  }
  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    db = client.db(dbName);
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ googleId: 1 }, { unique: true, sparse: true });
    await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection('rides').createIndex({ userId: 1, rideId: 1 }, { unique: true });
    await db.collection('rides').createIndex({ userId: 1, 'summary.startedAt': -1 });
    accountMessage = '';
    console.log(`MongoDB: connected (${dbName})`);
  } catch (err) {
    db = null;
    accountMessage = 'Could not reach MongoDB. Check MONGODB_URI, and allow this computer in Atlas Network Access.';
    console.error('MongoDB connection failed:', err instanceof Error ? err.message : err);
    await client?.close().catch(() => {});
    // Keep trying, so a short database outage at start-up does not need a restart.
    console.log(`MongoDB: retrying in ${MONGO_RETRY_MS / 1000} s`);
    setTimeout(() => void connectMongo(), MONGO_RETRY_MS).unref();
  }
}

// Sign-in and sign-up attempts: 30 per IP and 10 per email every 15 minutes.
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authByIp = createRateLimiter({ limit: 30, windowMs: AUTH_WINDOW_MS });
const authByEmail = createRateLimiter({ limit: 10, windowMs: AUTH_WINDOW_MS });
setInterval(() => {
  authByIp.prune();
  authByEmail.prune();
}, 60_000).unref();

/** The client address. Behind a reverse proxy, set TRUST_PROXY=1 to use X-Forwarded-For. */
function clientIp(req) {
  if (process.env.TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

/** False (and a 429 sent) when this IP or email made too many attempts. */
function allowAuthAttempt(req, res, email) {
  const ipOk = authByIp.hit(clientIp(req));
  const emailOk = email ? authByEmail.hit(email) : true;
  if (ipOk && emailOk) return true;
  res.setHeader('Retry-After', String(AUTH_WINDOW_MS / 1000));
  send(res, 429, { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
  return false;
}

function publicUser(user) {
  return { id: String(user._id), email: user.email, name: user.name };
}

function signSession(id) {
  const sig = createHmac('sha256', sessionSecret).update(id).digest('hex');
  return `${id}.${sig}`;
}

function readSessionId(req) {
  const value = readCookie(req.headers.cookie, cookieName);
  if (!value || !sessionSecret) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac('sha256', sessionSecret).update(id).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

function setSessionCookie(res, token) {
  const secure = production ? '; Secure' : '';
  const maxAge = sessionDays * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`);
}

function clearSessionCookie(res) {
  const secure = production ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
}

async function createSession(res, userId) {
  const id = randomBytes(24).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionDays * 24 * 60 * 60 * 1000);
  await db.collection('sessions').insertOne({ _id: id, userId, createdAt: now, expiresAt });
  setSessionCookie(res, signSession(id));
}

async function currentUser(req) {
  if (!db) return null;
  const id = readSessionId(req);
  if (!id) return null;
  const session = await db.collection('sessions').findOne({ _id: id });
  if (!session || session.expiresAt < new Date()) {
    if (session) await db.collection('sessions').deleteOne({ _id: id });
    return null;
  }
  return db.collection('users').findOne({ _id: session.userId });
}

function cleanEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

async function handleApi(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Login CSRF and cross-site writes: a browser always sends Origin on these.
    if (!originAllowed(req, { production, appOrigin })) {
      req.resume();
      return send(res, 403, { error: 'This request came from another site.' });
    }
    if (hasBody(req) && !isJson(req)) {
      req.resume();
      return send(res, 415, { error: 'Send the request as JSON.' });
    }
  }

  if (url.pathname === '/api/auth/config' && req.method === 'GET') {
    return send(res, 200, {
      ready: Boolean(db),
      googleClientId,
      message: accountMessage,
    });
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await currentUser(req);
    return send(res, 200, { user: user ? publicUser(user) : null, ready: Boolean(db) });
  }

  if (!db) return send(res, 503, { error: accountMessage || 'Accounts are not available yet.' });

  if (url.pathname === '/api/auth/signout' && req.method === 'POST') {
    const id = readSessionId(req);
    if (id) await db.collection('sessions').deleteOne({ _id: id });
    clearSessionCookie(res);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/auth/signup' && req.method === 'POST') {
    const body = await readBody(req);
    const name = cleanName(body.name);
    const email = cleanEmail(body.email);
    const password = String(body.password ?? '');
    if (!allowAuthAttempt(req, res, validEmail(email) ? email : '')) return;
    if (name.length < 1) return send(res, 400, { error: 'Enter your name.' });
    if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'Use a password of at least 8 characters.' });
    const existing = await db.collection('users').findOne({ email });
    if (existing) return send(res, 409, { error: 'An account with this email already exists. Sign in instead.' });
    const now = new Date();
    const doc = { email, name, passwordHash: await hashPassword(password), createdAt: now, updatedAt: now };
    let inserted;
    try {
      inserted = await db.collection('users').insertOne(doc);
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
        return send(res, 409, { error: 'An account with this email already exists. Sign in instead.' });
      }
      throw err;
    }
    const user = { ...doc, _id: inserted.insertedId };
    await createSession(res, user._id);
    return send(res, 200, { user: publicUser(user) });
  }

  if (url.pathname === '/api/auth/signin' && req.method === 'POST') {
    const body = await readBody(req);
    const email = cleanEmail(body.email);
    const password = String(body.password ?? '');
    if (!allowAuthAttempt(req, res, validEmail(email) ? email : '')) return;
    const user = validEmail(email) ? await db.collection('users').findOne({ email }) : null;
    // Same message and the same scrypt work whether the account is missing, Google-only,
    // or the password is wrong, so sign-in does not reveal which emails have accounts.
    const stored = user?.passwordHash || (await dummyPasswordHash());
    const tooLong = password.length > 200;
    const check = await verifyPassword(tooLong ? '' : password, stored);
    if (!user?.passwordHash || tooLong || !check.ok) {
      return send(res, 401, { error: 'Email or password is wrong. If you signed up with Google, use the Google button.' });
    }
    if (check.rehash) {
      await db.collection('users').updateOne(
        { _id: user._id, passwordHash: user.passwordHash },
        { $set: { passwordHash: await hashPassword(password) } },
      );
    }
    await createSession(res, user._id);
    return send(res, 200, { user: publicUser(user) });
  }

  if (url.pathname === '/api/auth/google' && req.method === 'POST') {
    if (!googleClientId) return send(res, 503, { error: 'Add GOOGLE_CLIENT_ID to .env, then restart the app.' });
    const body = await readBody(req);
    const credential = String(body.credential ?? '');
    if (!credential) return send(res, 400, { error: 'Google did not return a sign-in.' });
    let info;
    try {
      const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!infoRes.ok) return send(res, 401, { error: 'Google sign-in could not be verified.' });
      info = await infoRes.json();
    } catch (err) {
      console.error('Google tokeninfo failed:', err instanceof Error ? err.message : err);
      return send(res, 502, { error: 'Google sign-in could not be checked right now. Please try again.' });
    }
    if (!info || typeof info !== 'object') return send(res, 401, { error: 'Google sign-in could not be verified.' });
    if (info.aud !== googleClientId) return send(res, 401, { error: 'Google sign-in was issued for a different app.' });
    if (info.email_verified !== 'true' && info.email_verified !== true) {
      return send(res, 401, { error: 'That Google account does not have a verified email.' });
    }
    const email = cleanEmail(info.email);
    const googleId = String(info.sub ?? '');
    if (!validEmail(email) || !googleId) return send(res, 401, { error: 'Google did not share an email address.' });
    const name = cleanName(info.name || email.split('@')[0]);
    const now = new Date();
    let user = await db.collection('users').findOne({ $or: [{ googleId }, { email }] });
    if (!user) {
      const doc = { email, name, passwordHash: null, googleId, emailVerified: true, createdAt: now, updatedAt: now };
      const inserted = await db.collection('users').insertOne(doc);
      user = { ...doc, _id: inserted.insertedId };
    } else if (user.googleId && user.googleId !== googleId) {
      return send(res, 409, { error: 'This email is already linked to a different Google account.' });
    } else {
      const set = { googleId, emailVerified: true, name: user.name || name, updatedAt: now };
      if (user.passwordHash && !user.emailVerified) {
        // Sign-up never proves the email, so a password account with this address may
        // have been made by someone else. Google just proved who owns the email: drop
        // the unproven password and end every session it opened.
        set.passwordHash = null;
        await db.collection('sessions').deleteMany({ userId: user._id });
      }
      await db.collection('users').updateOne({ _id: user._id }, { $set: set });
      user = { ...user, ...set };
    }
    await createSession(res, user._id);
    return send(res, 200, { user: publicUser(user) });
  }

  if (url.pathname === '/api/profile') return handleProfile(req, res);

  if (url.pathname === '/api/rides' || url.pathname.startsWith('/api/rides/')) {
    return handleRides(req, res, url);
  }

  return send(res, 404, { error: 'Not found.' });
}

async function handleProfile(req, res) {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Sign in to save your rider.' });
  if (req.method === 'GET') {
    return send(res, 200, { profile: user.profile ? cleanProfile(user.profile) : null });
  }
  if (req.method === 'PUT') {
    const profile = mergeProfiles(user.profile, await readBody(req));
    if (!profile) return send(res, 400, { error: 'That rider profile could not be saved.' });
    await db.collection('users').updateOne({ _id: user._id }, { $set: { profile, updatedAt: new Date() } });
    return send(res, 200, { profile });
  }
  return send(res, 405, { error: 'Not found.' });
}

function rideKey(userId, rideId) {
  return `${String(userId)}:${rideId}`;
}

function validRideId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(id);
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function text(value, max) {
  return String(value ?? '').slice(0, max);
}

/** What a Hill climb race was. Null when it cannot be read, and the ride is saved without it. */
function cleanHill(hill) {
  if (!hill || typeof hill !== 'object') return null;
  if (!Array.isArray(hill.results) || hill.results.length > 200) return null;
  if (hill.results.some((row) => !row || typeof row !== 'object')) return null;
  return {
    climbName: text(hill.climbName, 80),
    lengthM: num(hill.lengthM),
    gainM: num(hill.gainM),
    avgGrade: num(hill.avgGrade),
    weightKg: num(hill.weightKg),
    ftp: num(hill.ftp),
    aiCount: num(hill.aiCount),
    topWkg: num(hill.topWkg),
    bottomWkg: num(hill.bottomWkg),
    results: hill.results.map((row) => ({
      name: text(row.name, 60),
      country: text(row.country, 8),
      timeSec: row.timeSec == null ? null : num(row.timeSec),
      wkg: num(row.wkg),
      drop: num(row.drop),
      ...(row.player ? { player: true } : {}),
    })),
  };
}

function cleanSummary(summary, rideId) {
  if (!summary || typeof summary !== 'object') return null;
  if (summary.id !== rideId) return null;
  if (summary.mode !== 'free' && summary.mode !== 'race' && summary.mode !== 'train') return null;
  if (typeof summary.startedAt !== 'string' || Number.isNaN(Date.parse(summary.startedAt))) return null;
  const out = {
    id: rideId,
    createdAt: text(summary.createdAt, 40),
    updatedAt: text(summary.updatedAt, 40),
    startedAt: summary.startedAt,
    mode: summary.mode,
    routeId: text(summary.routeId, 40),
    routeName: text(summary.routeName, 80),
    title: text(summary.title, 120),
    durationSec: num(summary.durationSec),
    movingSec: num(summary.movingSec),
    distanceM: num(summary.distanceM),
    ascentM: num(summary.ascentM),
    avgPower: num(summary.avgPower),
    maxPower: num(summary.maxPower),
    normalizedPower: num(summary.normalizedPower),
    avgCadence: num(summary.avgCadence),
    avgHeartRate: num(summary.avgHeartRate),
    maxHeartRate: num(summary.maxHeartRate),
    avgSpeedKmh: num(summary.avgSpeedKmh),
    hasFit: Boolean(summary.hasFit),
  };
  if (summary.climbId) out.climbId = text(summary.climbId, 80);
  if (summary.laps != null) out.laps = num(summary.laps);
  if (summary.workout && typeof summary.workout === 'object' && summary.workout.planId && summary.workout.workoutId) {
    const estimate = Number(summary.workout.ftpEstimate);
    const compliance = summary.workout.compliance;
    const average = Number(summary.workout.ftpAverage);
    const previous = Number(summary.workout.previousFtp);
    const weight = Number(summary.workout.weightKg);
    const kind = summary.workout.ftpKind === 'twenty' || summary.workout.ftpKind === 'ramp' ? summary.workout.ftpKind : null;
    out.workout = {
      planId: text(summary.workout.planId, 40),
      workoutId: text(summary.workout.workoutId, 80),
      name: text(summary.workout.name, 80),
      compliance: compliance == null || !Number.isFinite(Number(compliance)) ? null : num(compliance),
      ftpEstimate: Number.isFinite(estimate) && estimate > 0 ? num(estimate) : null,
      ftpKind: kind,
      ftpAverage: Number.isFinite(average) && average > 0 ? Math.round(average) : null,
      previousFtp: Number.isFinite(previous) && previous > 0 ? Math.round(previous) : null,
      weightKg: Number.isFinite(weight) && weight > 0 ? Math.round(weight * 10) / 10 : null,
      completed: Boolean(summary.workout.completed),
    };
  }
  if (summary.race && typeof summary.race === 'object') {
    out.race = {
      position: num(summary.race.position),
      field: num(summary.race.field),
      finishTimeSec: summary.race.finishTimeSec == null ? null : num(summary.race.finishTimeSec),
      winnerTimeSec: summary.race.winnerTimeSec == null ? null : num(summary.race.winnerTimeSec),
    };
    const hill = cleanHill(summary.race.hill);
    if (hill) out.race.hill = hill;
  }
  return out;
}

function cleanSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  return {
    t: num(sample.t),
    power: num(sample.power),
    cadence: num(sample.cadence),
    heartRate: num(sample.heartRate),
    speed: num(sample.speed),
    distance: num(sample.distance),
    altitude: num(sample.altitude),
    grade: num(sample.grade),
  };
}

function cleanEffort(effort, rideId) {
  if (!effort || typeof effort !== 'object') return null;
  if (typeof effort.id !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(effort.id)) return null;
  return {
    id: effort.id,
    climbId: text(effort.climbId, 80),
    climbName: text(effort.climbName, 80),
    routeId: text(effort.routeId, 40),
    routeName: text(effort.routeName, 80),
    lengthM: num(effort.lengthM),
    rideId,
    createdAt: text(effort.createdAt, 40),
    timeSec: num(effort.timeSec),
    avgPower: num(effort.avgPower),
    wkg: num(effort.wkg),
  };
}

function fitToBase64(fit) {
  if (!fit) return null;
  if (Buffer.isBuffer(fit)) return fit.toString('base64');
  if (typeof fit.value === 'function') return Buffer.from(fit.value()).toString('base64');
  return null;
}

async function handleRides(req, res, url) {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Sign in to see your rides.' });
  const rides = db.collection('rides');

  if (url.pathname === '/api/rides' && req.method === 'GET') {
    const docs = await rides
      .find({ userId: user._id }, { projection: { samples: 0, fit: 0 } })
      .sort({ 'summary.startedAt': -1 })
      .toArray();
    return send(res, 200, {
      rides: docs.map((doc) => doc.summary),
      efforts: docs.flatMap((doc) => doc.efforts ?? []),
    });
  }

  const match = url.pathname.match(/^\/api\/rides\/([^/]+)$/);
  if (!match) return send(res, 404, { error: 'Not found.' });
  const rideId = decodeURIComponent(match[1]);
  if (!validRideId(rideId)) return send(res, 400, { error: 'That ride id is not valid.' });
  const _id = rideKey(user._id, rideId);

  if (req.method === 'GET') {
    const doc = await rides.findOne({ _id, userId: user._id });
    if (!doc) return send(res, 404, { error: 'Ride not found.' });
    return send(res, 200, {
      summary: doc.summary,
      samples: doc.samples ?? [],
      fitBase64: fitToBase64(doc.fit),
      efforts: doc.efforts ?? [],
    });
  }

  if (req.method === 'DELETE') {
    await rides.deleteOne({ _id, userId: user._id });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'PUT') {
    const body = await readBody(req, 12_000_000);
    const summary = cleanSummary(body.summary, rideId);
    if (!summary) return send(res, 400, { error: 'The ride could not be read.' });
    if (!Array.isArray(body.samples) || body.samples.length > 100_000) {
      return send(res, 400, { error: 'The ride samples could not be read.' });
    }
    const samples = body.samples.map(cleanSample);
    if (samples.some((sample) => !sample)) return send(res, 400, { error: 'The ride samples could not be read.' });
    const efforts = Array.isArray(body.efforts) ? body.efforts.map((effort) => cleanEffort(effort, rideId)) : [];
    if (efforts.length > 200 || efforts.some((effort) => !effort)) {
      return send(res, 400, { error: 'The climb times could not be read.' });
    }
    let fit = null;
    if (body.fitBase64) {
      if (typeof body.fitBase64 !== 'string') return send(res, 400, { error: 'The FIT file could not be read.' });
      fit = Buffer.from(body.fitBase64, 'base64');
      if (fit.length > 8_000_000) return send(res, 413, { error: 'The FIT file is too large.' });
    }
    const now = new Date();
    await rides.updateOne(
      { _id, userId: user._id },
      {
        $set: {
          userId: user._id,
          rideId,
          summary,
          samples,
          fit: fit ? new Binary(fit) : null,
          efforts,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

function notFound(res) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

/** Streams a file, or answers 404 when it cannot be read (missing build, race with a deploy). */
function sendFile(res, file, headers) {
  const stream = createReadStream(file);
  stream.on('error', (err) => {
    console.error('Static file failed:', file, err.message);
    notFound(res);
  });
  stream.once('open', () => {
    res.writeHead(200, headers);
    stream.pipe(res);
  });
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function serveStatic(req, res, url) {
  const file = staticPath(dist, url.pathname);
  if (!file) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (isFile(file)) {
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    // Vite puts a content hash in every file name under /assets/.
    const cache = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    sendFile(res, file, { 'Content-Type': type, 'Cache-Control': cache });
    return;
  }
  if (path.extname(url.pathname)) {
    notFound(res);
    return;
  }
  sendFile(res, path.join(dist, 'index.html'), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
}

/** Answers one request. `npm start` serves it below; on Vercel, api/index.js calls it. */
export async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (production) {
      serveStatic(req, res, url);
      return;
    }
    send(res, 404, { error: 'Not found.' });
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err ? Number(err.status) : 500;
    if (!status || status >= 500) console.error(err);
    if (!res.headersSent) {
      if (err && typeof err === 'object' && err.close) res.setHeader('Connection', 'close');
      send(res, status || 500, { error: status === 500 ? 'Something went wrong.' : err.message });
    }
  }
}

await connectMongo();

// Run directly (`npm start`, `npm run dev`): listen. Imported (Vercel): only export `handle`.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(handle).listen(port, production ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`CycleBuddy API on http://127.0.0.1:${port}`);
  });
}
