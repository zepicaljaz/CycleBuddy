// Local development without MongoDB Atlas: starts a private MongoDB on this
// machine (data kept in .localdb/), then runs the normal dev script against it.
// Usage: npm run dev:local
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, '.localdb');
mkdirSync(dbPath, { recursive: true });

const mongo = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
console.log(`Local MongoDB: ${mongo.getUri()} (data in .localdb/)`);

const env = {
  ...process.env,
  MONGODB_URI: mongo.getUri(),
  MONGODB_DB: process.env.MONGODB_DB || 'cyclebuddy-local',
  SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
};
const script = process.argv.includes('--api-only') ? 'server/index.js' : 'server/dev.js';
const child = spawn(process.execPath, [script], { cwd: root, stdio: 'inherit', env });

async function stop(code = 0) {
  child.kill('SIGTERM');
  await mongo.stop({ doCleanup: false });
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
child.on('exit', (code) => void stop(code ?? 0));
