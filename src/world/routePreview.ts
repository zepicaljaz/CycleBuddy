import { excerptRoute, ROUTE_DS, type Route } from '../routes/route';
import { planTowns } from './scenery';
import { TerrainField } from './terrainField';
import { World } from './world';

/**
 * Still of one route's landscape, with no rider. The free-ride list uses the
 * compressed files in public/route-previews so opening that page does not build a world.
 */
export function previewDistance(route: Route): number {
  const towns = planTowns(route);
  const water = route.def.scenery.waterLevel;
  const inTown = (s: number) => towns.some((t) => s >= t.s0 - 140 && s <= t.s1 + 140);
  let bestS = Math.min(route.length * 0.42, Math.max(route.length * 0.2, 800));
  let best = -Infinity;
  const step = Math.max(ROUTE_DS * 12, route.length / 72);
  for (let s = step; s < route.length - step * 0.4; s += step) {
    if (inTown(s)) continue;
    const y = route.elevationAt(s);
    const ahead = route.elevationAt(route.wrap(s + 420));
    let score = Math.abs(ahead - y) * 1.6 + Math.min(y, 2200) * 0.012;
    if (water !== null) score += Math.max(0, 28 - Math.abs(y - water - 6)) * 2.4;
    if (score > best) {
      best = score;
      bestS = s;
    }
  }
  return bestS;
}

/** Loops whose card shows the road running ahead through that world's landscape. */
const VALLEY_PREVIEWS = new Set(['cielo', 'provence', 'dolomite', 'canyon', 'highland', 'brittany', 'flanders']);

/** A stretch of road with the camera looking along it, not back into the rest of the loop. */
function valleyFrame(route: Route): { excerpt: Route; anchor: number } {
  if (route.def.id === 'cielo') {
    const anchorFull = (route.climbs[0]?.start ?? 1000) - 1000;
    const cut = excerptRoute(route, anchorFull - 900, anchorFull + 15000);
    return { excerpt: cut.route, anchor: anchorFull - cut.from };
  }
  const climb = route.climbs[0]?.start ?? route.length * 0.35;
  const anchorFull = Math.max(1800, Math.min(climb - 900, Math.max(1800, route.length - 4500)));
  const cut = excerptRoute(route, Math.max(0, anchorFull - 800), Math.min(route.length - 4, anchorFull + 12000));
  return { excerpt: cut.route, anchor: anchorFull - cut.from };
}

/**
 * The road runs up the alley and the landscape stands on either side.
 * The rider stays out of the picture.
 */
async function renderValleyPreview(route: Route): Promise<string> {
  const { excerpt, anchor } = valleyFrame(route);
  const here = excerpt.sample(anchor);
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  canvas.style.cssText = 'position:fixed;left:-6000px;top:0;width:640px;height:360px;pointer-events:none';
  document.body.appendChild(canvas);
  if (!canvas.clientWidth) await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  let world: World | null = null;
  try {
    world = new World(excerpt, canvas, null, 'high', 'golden', {
      riderCapacity: 1,
      corridor: true,
      focus: { x: here.x, z: here.z },
      terrain: { viewDistance: 5600, splitDistance: 1600, lod0Distance: 700, treeDensity: 0.8, treeDistance: 1800 },
    });
    world.riders.group.visible = false;
    world.setTrafficEnabled(false);
    world.holdValley(anchor);
    const started = performance.now();
    const deadline = started + 22000;
    let last = -1;
    let stable = 0;
    while (performance.now() < deadline) {
      world.update(0, 0, 0, []);
      const progress = world.loadProgress;
      if (Math.abs(progress - last) < 0.001) stable += 1;
      else stable = 0;
      last = progress;
      if (stable >= 2 && progress >= 0.4) break;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    world.update(0, 0, 0, []);
    const shot = document.createElement('canvas');
    shot.width = 520;
    shot.height = 292;
    const ctx = shot.getContext('2d');
    if (!ctx) throw new Error('preview surface');
    ctx.drawImage(canvas, 0, 0, 520, 292);
    return shot.toDataURL('image/jpeg', 0.72);
  } finally {
    if (world) {
      const renderer = world.graphicsRef.renderer;
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
    canvas.remove();
  }
}

/**
 * Mirror Lake's card uses the aerial view along the shore: the road
 * comes toward the camera, the lake is beside it, and the island sits ahead.
 * No rider.
 */
async function renderLakePreview(route: Route): Promise<string | null> {
  const field = new TerrainField({
    x: route.x,
    z: route.z,
    y: route.y,
    seed: route.def.seed,
    scenery: route.def.scenery,
  });
  const island = field.islandCenter();
  if (!island) return null;
  const s = 430;
  const behind = route.sample(route.wrap(s - 26));
  const pose = route.sample(s);
  const dx = island.x - pose.x;
  const dz = island.z - pose.z;
  const dist = Math.hypot(dx, dz) || 1;
  const cross = pose.tx * (dz / dist) - pose.tz * (dx / dist);
  const yaw = (24 * Math.PI) / 180 * Math.sign(cross || 1);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const lookTx = pose.tx * cos - pose.tz * sin;
  const lookTz = pose.tz * cos + pose.tx * sin;
  const lookReach = 170;
  const lookX = pose.x + lookTx * lookReach;
  const lookZ = pose.z + lookTz * lookReach;
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 450;
  canvas.style.cssText = 'position:fixed;left:-6000px;top:0;width:800px;height:450px;pointer-events:none';
  document.body.appendChild(canvas);
  if (!canvas.clientWidth) await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  let world: World | null = null;
  try {
    world = new World(route, canvas, null, 'high', 'golden', {
      riderCapacity: 1,
      focus: { x: (pose.x + island.x) / 2, z: (pose.z + island.z) / 2 },
      terrain: { viewDistance: 2600, splitDistance: 1600, lod0Distance: 900, treeDensity: 1, treeDistance: 1600 },
    });
    world.riders.group.visible = false;
    world.setTrafficEnabled(false);
    world.holdFrame(behind.x, behind.y + 12, behind.z, lookX, pose.y + 2, lookZ);
    const started = performance.now();
    const deadline = started + 22000;
    let last = -1;
    let stable = 0;
    while (performance.now() < deadline) {
      world.update(0, 0, 0, []);
      const progress = world.loadProgress;
      if (Math.abs(progress - last) < 0.001) stable += 1;
      else stable = 0;
      last = progress;
      if (stable >= 2 && progress >= 0.45) break;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    world.update(0, 0, 0, []);
    const shot = document.createElement('canvas');
    shot.width = 400;
    shot.height = 225;
    const ctx = shot.getContext('2d');
    if (!ctx) throw new Error('preview surface');
    ctx.drawImage(canvas, 0, 0, 400, 225);
    return shot.toDataURL('image/jpeg', 0.72);
  } finally {
    if (world) {
      const renderer = world.graphicsRef.renderer;
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
    canvas.remove();
  }
}

/** Render one compressed JPEG from the real terrain, trees, water and sky. */
export async function renderRoutePreview(route: Route): Promise<string> {
  if (VALLEY_PREVIEWS.has(route.def.id)) return renderValleyPreview(route);
  if (route.def.id === 'lake') {
    const shot = await renderLakePreview(route);
    if (shot) return shot;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 270;
  canvas.setAttribute('data-route-preview', route.def.id);
  canvas.style.cssText = 'position:fixed;left:-6000px;top:0;width:480px;height:270px;pointer-events:none';
  document.body.appendChild(canvas);
  if (!canvas.clientWidth) await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  const s = previewDistance(route);
  const here = route.sample(s);
  let world: World | null = null;
  try {
    world = new World(route, canvas, null, 'low', 'golden', {
      riderCapacity: 1,
      focus: { x: here.x, z: here.z },
      terrain: { viewDistance: 1400, splitDistance: 1200, lod0Distance: 520, treeDensity: 1, treeDistance: 1100 },
    });
    world.riders.group.visible = false;
    world.setTrafficEnabled(false);
    world.holdPreview(s);
    const started = performance.now();
    const deadline = started + 12000;
    let last = -1;
    let stable = 0;
    while (performance.now() < deadline) {
      world.update(0, 0, 0, []);
      const progress = world.loadProgress;
      if (Math.abs(progress - last) < 0.001) stable += 1;
      else stable = 0;
      last = progress;
      if (stable >= 2 && progress >= 0.45) break;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    world.update(0, 0, 0, []);
    const shot = document.createElement('canvas');
    shot.width = 400;
    shot.height = 225;
    const ctx = shot.getContext('2d');
    if (!ctx) throw new Error('preview surface');
    ctx.drawImage(canvas, 0, 0, 400, 225);
    return shot.toDataURL('image/jpeg', 0.62);
  } finally {
    if (world) {
      const renderer = world.graphicsRef.renderer;
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
    canvas.remove();
  }
}
