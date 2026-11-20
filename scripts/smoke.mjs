// After `npm run build`: starts the production server (no database needed) and checks the
// homepage, the game page and every file they load answer 200, and the API answers.
// Usage: npm run build && npm run smoke
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 18_500 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), MONGODB_URI: '', SESSION_SECRET: '' };
const server = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (c) => (log += c));
server.stderr.on('data', (c) => (log += c));

const fail = (message) => {
  console.error(`✗ ${message}\n${log}`);
  server.kill();
  process.exit(1);
};

const until = Date.now() + 20_000;
while (!/CycleBuddy API on/.test(log)) {
  if (Date.now() > until || server.exitCode !== null) fail('the production server did not start');
  await new Promise((r) => setTimeout(r, 100));
}

async function get(url) {
  const res = await fetch(base + url);
  if (res.status !== 200) fail(`${url} answered ${res.status}`);
  return res;
}

for (const page of ['/', '/play']) {
  const html = await (await get(page)).text();
  if (!html.includes('id="app"')) fail(`${page} is not the CycleBuddy page`);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (assets.length === 0) fail(`${page} loads no built assets`);
  for (const asset of assets) await get(asset);
  console.log(`✓ ${page} and its ${assets.length} files`);
}

const config = await (await get('/api/auth/config')).json();
if (typeof config.ready !== 'boolean') fail('/api/auth/config did not answer');
console.log('✓ /api/auth/config');

server.kill();
console.log('Smoke test passed.');
