// House rules, checked on every pull request. Each test says what the rule is; the
// message on failure says what to fix. Rules live in CONTRIBUTING.md and CLAUDE.md.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RIDE_REGIONS } from '../src/routes/regions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

function files(dir, test, out = []) {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) files(rel, test, out);
    else if (test(rel)) out.push(rel);
  }
  return out;
}

const source = (file) => /\.(ts|js|mjs)$/.test(file) && !/\.test\.|\.d\.ts$/.test(file);

describe('versions', () => {
  const version = JSON.parse(read('package.json')).version;

  it('package.json and package-lock.json carry the same version', () => {
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.version, 'package-lock.json "version"').toBe(version);
    expect(lock.packages[''].version, 'package-lock.json packages[""].version').toBe(version);
  });

  it('CHANGES.md has a section for the current version', () => {
    expect(read('CHANGES.md'), `add "## ${version} (date)" to CHANGES.md`).toMatch(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm'));
  });

  it('README.md states the current version', () => {
    expect(read('README.md')).toContain(`Current version: ${version}`);
  });
});

describe('README map ("Where everything is")', () => {
  const readme = read('README.md');

  it('names every folder in src/', () => {
    const folders = readdirSync(path.join(ROOT, 'src'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const missing = folders.filter((name) => !readme.includes(`${name}/`));
    expect(missing, 'add these folders to the README map').toEqual([]);
  });

  it('names every file in the folders it maps file by file', () => {
    const byFile = ['src/game', 'src/world', 'src/ui', 'src/ai', 'src/physics', 'server'];
    const top = readdirSync(path.join(ROOT, 'src/routes')).filter((f) => source(f)).map((f) => path.join('src/routes', f));
    const all = [...byFile.flatMap((dir) => files(dir, source)), ...top];
    const missing = all.filter((file) => !readme.includes(path.basename(file)));
    expect(missing, 'add these files to the README map').toEqual([]);
  });

  it('every file the map names exists', () => {
    const named = [...readme.matchAll(/`((?:src\/|server\/|scripts\/|docs\/)[\w./-]+\.\w+)`/g)].map((m) => m[1]);
    const gone = named.filter((file) => !existsSync(path.join(ROOT, file)));
    expect(gone, 'the README names files that are no longer there').toEqual([]);
  });
});

describe('nothing private or heavy is committed', () => {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

  it('no .env, local database, keys or DEM cache', () => {
    const bad = tracked.filter((file) =>
      (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example')) ||
      file.startsWith('.localdb/') ||
      file.startsWith('data/dem-cache/') ||
      /\.(pem|key|p12)$/.test(file),
    );
    expect(bad).toEqual([]);
  });

  it('no screen recordings and no file over 5 MB', () => {
    const big = tracked.filter((file) => {
      if (/\.(mov|mp4|webm|mkv)$/i.test(file)) return true;
      const full = path.join(ROOT, file);
      return existsSync(full) && statSync(full).size > 5_000_000;
    });
    expect(big).toEqual([]);
  });
});

describe('code rules', () => {
  const code = files('src', source);

  it('no browser alert() or prompt(); confirm() only where it already is', () => {
    const alerts = [];
    let confirms = 0;
    for (const file of code) {
      read(file).split('\n').forEach((line, i) => {
        const text = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (/(^|[^.\w$])(window\.)?(alert|prompt)\(/.test(text)) alerts.push(`${file}:${i + 1}`);
        if (/(^|[^.\w$])(window\.)?confirm\(/.test(text)) confirms += 1;
      });
    }
    expect(alerts).toEqual([]);
    // Delete ride, discard ride, delete career. A new one should be an in-game dialog.
    expect(confirms, 'use an in-game dialog instead of a new confirm()').toBeLessThanOrEqual(3);
  });

  it('no emoji in the game UI', () => {
    // Characters that draw as a colour emoji. Typographic marks like ★ are fine.
    const emoji = /\p{Emoji_Presentation}/u;
    const hits = [...code, 'src/styles.css', 'src/ui/menus.css'].filter((file) => emoji.test(read(file)));
    expect(hits).toEqual([]);
  });
});

describe('free ride picker', () => {
  it('every loop in a landscape has its preview image', () => {
    const missing = RIDE_REGIONS.flatMap((region) => region.routes)
      .filter((id) => !existsSync(path.join(ROOT, 'public/route-previews', `${id}.jpg`)));
    expect(missing).toEqual([]);
  });
});
