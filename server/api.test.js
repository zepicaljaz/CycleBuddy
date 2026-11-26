// The account server runs end to end: it starts against a throwaway in-memory MongoDB and
// goes through sign-up, the session, the rider profile, saving and reading a ride, two
// accounts kept apart, and sign-out. Nothing touches .localdb/ or a real database.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_COLORS } from '../src/world/riders';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 18_000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let mongo;
let server;
let log = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      MONGODB_URI: mongo.getUri(),
      MONGODB_DB: 'cyclebuddy-test',
      SESSION_SECRET: randomBytes(32).toString('hex'),
    },
  });
  server.stdout.on('data', (chunk) => (log += chunk));
  server.stderr.on('data', (chunk) => (log += chunk));
  const ready = Date.now() + 30_000;
  while (!/MongoDB: connected/.test(log) || !/CycleBuddy API on/.test(log)) {
    if (Date.now() > ready || server.exitCode !== null) throw new Error(`The server did not start:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 60_000);

afterAll(async () => {
  server?.kill('SIGTERM');
  await mongo?.stop();
});

/** A client with its own cookie jar: one browser. */
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

function ride(id) {
  return {
    summary: {
      id,
      createdAt: '2026-11-16T07:00:00.000Z',
      updatedAt: '2026-11-16T08:00:00.000Z',
      startedAt: '2026-11-16T07:00:00.000Z',
      mode: 'free',
      routeId: 'alpine',
      routeName: 'Alpine Pass',
      title: 'Alpine Pass',
      durationSec: 3600,
      movingSec: 3500,
      distanceM: 28000,
      ascentM: 640,
      avgPower: 190,
      maxPower: 520,
      normalizedPower: 205,
      avgCadence: 86,
      avgHeartRate: 0,
      maxHeartRate: 0,
      avgSpeedKmh: 28,
      hasFit: false,
    },
    samples: [
      { t: 0, power: 180, cadence: 85, heartRate: 0, speed: 8, distance: 0, altitude: 600, grade: 4 },
      { t: 1, power: 200, cadence: 88, heartRate: 0, speed: 8.1, distance: 8, altitude: 600.3, grade: 4 },
    ],
    efforts: [],
  };
}

// Password hashing is deliberately slow; a busy machine needs more than the 5 s default.
describe('account server', { timeout: 30_000 }, () => {
  const a = client();
  const b = client();

  it('is up, with accounts ready and nobody signed in', async () => {
    expect((await a('GET', '/api/auth/config')).body.ready).toBe(true);
    expect((await a('GET', '/api/auth/me')).body).toEqual({ user: null, ready: true });
  });

  it('signs up, keeps the session, and refuses the same email twice', async () => {
    const up = await a('POST', '/api/auth/signup', { name: 'Test Rider', email: 'rider@example.test', password: 'long-enough-1' });
    expect(up.status).toBe(200);
    expect(up.body.user.email).toBe('rider@example.test');
    expect((await a('GET', '/api/auth/me')).body.user.name).toBe('Test Rider');
    const again = await b('POST', '/api/auth/signup', { name: 'Other', email: 'rider@example.test', password: 'long-enough-2' });
    expect(again.status).toBe(409);
  });

  it('turns away a short password and a wrong one', async () => {
    expect((await b('POST', '/api/auth/signup', { name: 'B', email: 'b@example.test', password: 'short' })).status).toBe(400);
    expect((await b('POST', '/api/auth/signin', { email: 'rider@example.test', password: 'wrong-password' })).status).toBe(401);
  });

  it('saves the rider profile and reads it back', async () => {
    expect((await a('GET', '/api/profile')).body.profile).toBeNull();
    const profile = {
      name: 'Test Rider',
      weightKg: 72,
      ftp: 240,
      difficulty: 50,
      colors: { ...DEFAULT_COLORS, bike: 'montvar', wheelBrand: 'montvar' },
      coins: 0,
      ownedFrames: ['montvar'],
      ownedWheels: ['montvar'],
      graphics: 'high',
      timeOfDay: 'golden',
      camera: 'chase',
      map: 'ahead',
      updatedAt: '2026-11-16T08:00:00.000Z',
    };
    const saved = await a('PUT', '/api/profile', profile);
    expect(saved.status).toBe(200);
    const back = await a('GET', '/api/profile');
    expect(back.body.profile.ftp).toBe(240);
    expect(back.body.profile.weightKg).toBe(72);
  });

  it('saves a ride, lists it, and returns its samples', async () => {
    expect((await a('PUT', '/api/rides/ride-test-0001', ride('ride-test-0001'))).status).toBe(200);
    const list = await a('GET', '/api/rides');
    expect(list.body.rides.map((r) => r.id)).toEqual(['ride-test-0001']);
    const one = await a('GET', '/api/rides/ride-test-0001');
    expect(one.body.samples).toHaveLength(2);
    expect(one.body.summary.routeName).toBe('Alpine Pass');
  });

  it('keeps what a Hill climb race was, and nothing it does not know', async () => {
    const body = ride('ride-test-hill');
    const hill = {
      climbName: 'Vršič', lengthM: 10606, gainM: 800, avgGrade: 0.075, weightKg: 72, ftp: 250, aiCount: 1, topWkg: 5, bottomWkg: 1,
      results: [
        { name: 'T. Novarik', country: 'SLO', timeSec: 2059, wkg: 5, drop: 0 },
        { name: 'Me', country: '', timeSec: null, wkg: 3.1, drop: 0, player: true },
      ],
    };
    body.summary.mode = 'race';
    body.summary.race = { position: 2, field: 2, finishTimeSec: null, winnerTimeSec: 2059, hill: { ...hill, extra: 'x' } };
    expect((await a('PUT', '/api/rides/ride-test-hill', body)).status).toBe(200);
    const one = await a('GET', '/api/rides/ride-test-hill');
    expect(one.body.summary.race.hill).toEqual(hill);
    expect((await a('DELETE', '/api/rides/ride-test-hill')).status).toBe(200);
  });

  it('rejects a ride whose id does not match, and a bad id', async () => {
    expect((await a('PUT', '/api/rides/ride-test-0002', ride('ride-test-0001'))).status).toBe(400);
    expect((await a('GET', '/api/rides/no')).status).toBe(400);
  });

  it('keeps accounts apart: another rider sees none of it', async () => {
    expect((await b('GET', '/api/rides')).status).toBe(401);
    expect((await b('POST', '/api/auth/signup', { name: 'B', email: 'b@example.test', password: 'long-enough-3' })).status).toBe(200);
    expect((await b('GET', '/api/rides')).body.rides).toEqual([]);
    expect((await b('GET', '/api/rides/ride-test-0001')).status).toBe(404);
    expect((await b('DELETE', '/api/rides/ride-test-0001')).status).toBe(200);
    expect((await a('GET', '/api/rides')).body.rides).toHaveLength(1);
  });

  it('deletes a ride, signs out, and signs back in', async () => {
    expect((await a('DELETE', '/api/rides/ride-test-0001')).status).toBe(200);
    expect((await a('GET', '/api/rides')).body.rides).toEqual([]);
    await a('POST', '/api/auth/signout');
    expect((await a('GET', '/api/auth/me')).body.user).toBeNull();
    const back = await a('POST', '/api/auth/signin', { email: 'rider@example.test', password: 'long-enough-1' });
    expect(back.status).toBe(200);
    expect((await a('GET', '/api/auth/me')).body.user.email).toBe('rider@example.test');
  });

  it('answers 404 for an unknown endpoint', async () => {
    expect((await a('GET', '/api/nothing-here')).status).toBe(404);
  });
});
