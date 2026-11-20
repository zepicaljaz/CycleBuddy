import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = spawn(process.execPath, ['server/index.js'], { cwd: root, stdio: 'inherit' });

async function waitForApi() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (api.exitCode != null) return false;
    try {
      const res = await fetch('http://127.0.0.1:8787/api/auth/config');
      if (res.ok) return true;
    } catch {
      /* The API is still connecting to MongoDB. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

const apiUp = await waitForApi();
if (api.exitCode != null) process.exit(api.exitCode ?? 1);
if (!apiUp) console.error('Account server did not answer in time. Starting the site anyway.');

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin], { cwd: root, stdio: 'inherit' });

function shutdown() {
  api.kill('SIGTERM');
  vite.kill('SIGTERM');
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', shutdown);

vite.on('exit', (code) => {
  api.kill('SIGTERM');
  process.exit(code ?? 0);
});
api.on('exit', (code) => {
  if (code) {
    vite.kill('SIGTERM');
    process.exit(code);
  }
});
