// Before/after screenshots of fixed spots on the real roads (scripts/viewpoints.json).
//
//   node scripts/viewpoints.mjs <outDir> [--only <id>[,<id>…]] [--url http://localhost:5173] [--timeout 60] [--jobs 1]
//
// Starts a Vite dev server for preview.html (or uses the one given with --url), opens
// /preview.html?scene=road&… in headless Chromium for every spot and look, waits for the page's
// `window.__viewReady`, and saves <outDir>/<id>-<spotIndex>-<look>.png plus <outDir>/shots.json.
// A shot that times out or comes out blank is logged and skipped; the run carries on.
//
// Needs Playwright, which is not a dependency (the cached browser build decides the version):
//   npm i --no-save playwright@1.62        # Chromium build 1234
//   npx playwright@1.62 install chromium   # only if that build is not in ~/Library/Caches/ms-playwright
// WebGL runs on the GPU through ANGLE Metal (new headless mode); the log prints the renderer, and
// SwiftShader there means software rendering (slow, and shadows/AO can differ from a real screen).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const only = flag('--only')?.split(',');
let base = flag('--url');
const timeoutMs = Number(flag('--timeout') ?? 60) * 1000;
// Pages rendering at once. Each runs its own terrain workers, so on a laptop one is usually fastest.
const jobs = Math.max(1, Number(flag('--jobs') ?? 1));
const outDir = argv[0];
if (!outDir) {
  console.error('Usage: node scripts/viewpoints.mjs <outDir> [--only <id>] [--url <vite url>] [--timeout <s>] [--jobs <n>]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i --no-save playwright@1.62');
  process.exit(2);
}

const spots = JSON.parse(readFileSync(path.join(root, 'scripts/viewpoints.json'), 'utf8'));
const roads = spots.roads.filter((r) => !only || only.includes(r.id));
if (!roads.length) {
  console.error(`No road matches --only ${only}`);
  process.exit(2);
}

let server = null;
let browser = null;
const cleanup = async () => {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
};
process.on('SIGINT', () => cleanup().then(() => process.exit(130)));

const results = [];
try {
  if (!base) {
    const { createServer } = await import('vite');
    server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn', server: { port: 5190, strictPort: false, open: false } });
    await server.listen();
    base = server.resolvedUrls.local[0].replace(/\/$/, '');
  }
  console.log(`Vite: ${base}`);

  // channel 'chromium' = the full browser in new headless mode, which can use the GPU (the default
  // headless shell falls back to SwiftShader on macOS).
  browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const firstPage = await context.newPage();
  // First load compiles and pre-bundles everything; give it longer and use it to read the renderer.
  await firstPage.goto(`${base}/preview.html?scene=road&id=${roads[0].id}&km=${roads[0].spots[0].km}`, { timeout: 120_000 });
  const renderer = await firstPage.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL2';
  });
  console.log(`WebGL: ${renderer}${/swiftshader/i.test(renderer) ? '  (software rendering!)' : ''}`);
  await firstPage.waitForFunction(() => window.__viewReady || window.__viewError, null, { timeout: 120_000 }).catch(() => {});

  // One page load per spot; its other looks turn the same camera (window.__setLook) instead of rebuilding.
  // Spot by spot across the roads (every road's first spot, then every road's second…), so a run cut
  // short still has every road.
  const queue = roads.flatMap((road) => road.spots.map((spot, si) => ({ road, spot, si }))).sort((a, b) => a.si - b.si);
  const total = queue.reduce((a, q) => a + q.spot.looks.length, 0);
  const worker = async (page) => {
    let consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { road, spot, si } = job;
      consoleErrors = [];
      const q = new URLSearchParams({ scene: 'road', id: road.id, km: String(spot.km), look: spot.looks[0] });
      // Spot fields lat/lon are the GPS position; the page's sideways offset is `off`.
      for (const k of ['h', 'off', 'pitch', 't']) if (spot[k] != null) q.set(k, String(spot[k]));
      // The page gives up waiting for terrain a little before we do, and says so in __viewInfo.timedOut.
      q.set('timeout', String(Math.max(5000, timeoutMs - 10_000)));
      const url = `${base}/preview.html?${q}`;
      let loaded = false;
      for (const [li, look] of spot.looks.entries()) {
        const file = `${road.id}-${si}-${look}.png`;
        const rec = { file, id: road.id, spot: si, kind: spot.kind, km: spot.km, look, url: `/preview.html?${q}`.replace(/look=[^&]+/, `look=${look}`) };
        const started = Date.now();
        try {
          if (li === 0) {
            await page.goto(url, { timeout: timeoutMs });
            loaded = true;
          } else {
            if (!loaded) throw new Error('page did not load');
            await page.evaluate((l) => window.__setLook(l), look);
          }
          await page.waitForFunction(() => window.__viewReady || window.__viewError, null, { timeout: timeoutMs });
          const { error, info } = await page.evaluate(() => ({ error: window.__viewError, info: window.__viewInfo }));
          if (error) throw new Error(error);
          const png = await page.screenshot({ type: 'png', timeout: timeoutMs });
          const stats = await imageStats(page, png);
          if (stats.std < 4) throw new Error(`blank image (mean ${stats.mean.toFixed(0)}, std ${stats.std.toFixed(1)})`);
          writeFileSync(path.join(outDir, file), png);
          Object.assign(rec, { ok: true, ms: Date.now() - started, readyMs: info?.readyMs, chunks: info?.chunks, timedOut: info?.timedOut, std: +stats.std.toFixed(1) });
          console.log(`✓ ${file}  ${(rec.ms / 1000).toFixed(1)} s${info?.timedOut ? '  (terrain still loading at the page timeout)' : ''}  [${results.length + 1}/${total}]`);
        } catch (e) {
          Object.assign(rec, { ok: false, ms: Date.now() - started, error: String(e?.message ?? e).split('\n')[0], console: consoleErrors.slice(0, 5) });
          console.log(`✗ ${file}  ${rec.error}  [${results.length + 1}/${total}]`);
        }
        results.push(rec);
      }
    }
  };
  const pages = [firstPage];
  while (pages.length < jobs) pages.push(await context.newPage());
  await Promise.all(pages.map(worker));
  results.sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(path.join(outDir, 'shots.json'), JSON.stringify({ renderer, base, at: new Date().toISOString(), shots: results }, null, 2));
} finally {
  await cleanup();
}
const ok = results.filter((r) => r.ok);
const first = ok.filter((r) => r.look === roads.find((x) => x.id === r.id).spots[r.spot].looks[0]);
const avg = (list) => (list.length ? list.reduce((a, r) => a + r.ms, 0) / list.length / 1000 : 0).toFixed(1);
console.log(`${ok.length}/${results.length} shots in ${outDir} (a spot loads in ${avg(first)} s on average; each further look ${avg(ok.filter((r) => !first.includes(r)))} s)`);
process.exit(ok.length === results.length ? 0 : 1);

/** Mean and spread of the luminance, decoded in the page (no PNG library needed). A blank frame has almost no spread. */
async function imageStats(page, png) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(160, 90);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let sum = 0;
    let sq = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      sq += l * l;
    }
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  }, png.toString('base64'));
}
