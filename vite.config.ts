import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/** What this build is: package version, git commit, and whether the tree had uncommitted changes. */
function buildStamp() {
  const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
  // Vercel builds from a copy without git history, and says which commit it is.
  const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  if (vercelCommit) return { version, commit: vercelCommit, built: new Date().toISOString().slice(0, 10) };
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (execSync('git status --porcelain', { encoding: 'utf8' }).trim()) commit += '-dirty';
  } catch {
    // Not a git checkout (a zip): the version alone has to do.
  }
  return { version, commit, built: new Date().toISOString().slice(0, 10) };
}
const stamp = buildStamp();

export default defineConfig({
  test: {
    // Route and terrain tests build whole worlds; with every file running at once on a laptop
    // or a 4-core CI machine, the 5 s default is too short.
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
  define: {
    __APP_VERSION__: JSON.stringify(stamp.version),
    __APP_COMMIT__: JSON.stringify(stamp.commit),
    __APP_BUILT__: JSON.stringify(stamp.built),
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Libraries change less often than the app, so they cache separately.
        // three has the higher priority so the post group (which depends on it) does not swallow it.
        codeSplitting: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 2 },
            { name: 'post', test: /[\\/]node_modules[\\/](postprocessing|n8ao)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
