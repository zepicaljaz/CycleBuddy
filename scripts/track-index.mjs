// Regenerates src/routes/real/trackIndex.json (length and climbing of each real road's
// loop, for the Free ride list) from src/routes/real/tracks/*.json. Run it after adding
// or rebuilding a real road: `npm run track-index`. Works on macOS, Linux and Windows.
import { spawnSync } from 'node:child_process';

const run = spawnSync('npx', ['vitest', 'run', 'src/routes/real/trackIndex.test.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, UPDATE_TRACK_INDEX: '1' },
});
process.exit(run.status ?? 1);
