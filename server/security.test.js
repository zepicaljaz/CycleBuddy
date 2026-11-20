import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createRateLimiter, hashPassword, originAllowed, readBody, readCookie, staticPath, verifyPassword } from './security.js';

function fakeReq(body, headers = {}) {
  const chunks = body == null ? [] : [Buffer.from(body)];
  const req = Readable.from(chunks);
  const length = body == null ? undefined : String(Buffer.byteLength(body));
  req.headers = { ...(length ? { 'content-length': length } : {}), ...headers };
  return req;
}

describe('passwords', () => {
  it('hashes with a version prefix and verifies', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored.startsWith('s2$')).toBe(true);
    expect(await verifyPassword('correct horse', stored)).toEqual({ ok: true, rehash: false });
    expect((await verifyPassword('wrong horse', stored)).ok).toBe(false);
  });

  it('still verifies the old salt:hash format and asks for a rehash', async () => {
    const salt = randomBytes(16).toString('hex');
    const old = `${salt}:${scryptSync('hunter22', salt, 64).toString('hex')}`;
    expect(await verifyPassword('hunter22', old)).toEqual({ ok: true, rehash: true });
    expect(await verifyPassword('hunter23', old)).toEqual({ ok: false, rehash: false });
  });

  it('rejects empty or broken hashes', async () => {
    expect((await verifyPassword('x', null)).ok).toBe(false);
    expect((await verifyPassword('x', 's2$abc')).ok).toBe(false);
    expect((await verifyPassword('x', 'nonsense')).ok).toBe(false);
  });
});

describe('rate limiter', () => {
  it('blocks after the limit and resets after the window', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
    expect(limiter.hit('b')).toBe(true);
    t = 1000;
    expect(limiter.hit('a')).toBe(true);
    t = 5000;
    limiter.prune();
    expect(limiter.size).toBe(0);
  });
});

describe('origin check', () => {
  const req = (origin, host = '127.0.0.1:8787') => ({ headers: { ...(origin ? { origin } : {}), host } });

  it('allows requests without an Origin and same-origin requests', () => {
    expect(originAllowed(req(undefined), { production: true })).toBe(true);
    expect(originAllowed(req('https://cyclebuddy.app', 'cyclebuddy.app'), { production: true })).toBe(true);
  });

  it('blocks other sites', () => {
    expect(originAllowed(req('https://evil.example', 'cyclebuddy.app'), { production: true })).toBe(false);
    expect(originAllowed(req('http://cyclebuddy.app', 'cyclebuddy.app'), { production: true })).toBe(false);
    expect(originAllowed(req('null'), { production: false })).toBe(false);
    expect(originAllowed(req('https://evil.example'), { production: false })).toBe(false);
  });

  it('allows the Vite dev proxy outside production only', () => {
    expect(originAllowed(req('http://localhost:5173'), { production: false })).toBe(true);
    expect(originAllowed(req('http://localhost:5173', 'cyclebuddy.app'), { production: true })).toBe(false);
  });

  it('uses APP_ORIGIN when set', () => {
    const opts = { production: true, appOrigin: 'https://ride.example.com' };
    expect(originAllowed(req('https://ride.example.com', 'internal:8787'), opts)).toBe(true);
    expect(originAllowed(req('https://internal:8787', 'internal:8787'), opts)).toBe(false);
  });
});

describe('readBody', () => {
  const json = { 'content-type': 'application/json' };

  it('reads a JSON object', async () => {
    expect(await readBody(fakeReq('{"a":1}', json))).toEqual({ a: 1 });
    expect(await readBody(fakeReq(null))).toEqual({});
  });

  it('rejects non-objects with 400', async () => {
    for (const body of ['null', '[]', '3', '"x"', '{']) {
      await expect(readBody(fakeReq(body, json))).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects other content types with 415', async () => {
    await expect(readBody(fakeReq('{"a":1}', { 'content-type': 'text/plain' }))).rejects.toMatchObject({ status: 415 });
    await expect(readBody(fakeReq('a=1', { 'content-type': 'application/x-www-form-urlencoded' }))).rejects.toMatchObject({ status: 415 });
  });

  it('rejects oversized bodies with 413 from content-length and from the stream', async () => {
    await expect(readBody(fakeReq('{"a":"xxxxxxxxxx"}', json), 5)).rejects.toMatchObject({ status: 413 });
    const chunked = Readable.from([Buffer.from('{"a":"'), Buffer.from('x'.repeat(50)), Buffer.from('"}')]);
    chunked.headers = { ...json, 'transfer-encoding': 'chunked' };
    await expect(readBody(chunked, 20)).rejects.toMatchObject({ status: 413 });
  });
});

describe('cookies', () => {
  it('reads a cookie and treats bad encoding as missing', () => {
    expect(readCookie('a=1; cb_session=abc.def', 'cb_session')).toBe('abc.def');
    expect(readCookie('cb_session=%E0%A4%A', 'cb_session')).toBeNull();
    expect(readCookie(undefined, 'cb_session')).toBeNull();
  });
});

describe('static paths', () => {
  const dist = path.resolve('/srv/app/dist');

  it('stays inside dist', () => {
    expect(staticPath(dist, '/assets/a.js')).toBe(path.join(dist, 'assets', 'a.js'));
    expect(staticPath(dist, '/')).toBe(dist);
    expect(staticPath(dist, '/../dist-old/secret.js')).toBeNull();
    expect(staticPath(dist, '/%2e%2e/dist-old/secret.js')).toBeNull();
    expect(staticPath(dist, '/../../etc/passwd')).toBeNull();
    expect(staticPath(dist, '/%E0%A4%A')).toBeNull();
  });
});
