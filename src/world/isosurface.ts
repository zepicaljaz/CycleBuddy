/**
 * Closed mesh of the surface where a signed distance function is zero (surface nets).
 * Used for organic shapes that loft and sweep cannot make in one piece, like a pelvis
 * that runs into two thighs. Runs once per model at build time, never per frame.
 */

/** Signed distance in metres: negative inside, positive outside. */
export type Sdf = (x: number, y: number, z: number) => number;

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Isosurface {
  /** xyz per vertex, on the surface. */
  positions: Float32Array;
  /** Unit outward normal per vertex, from the field's gradient. */
  normals: Float32Array;
  /** Triangles, wound counter-clockwise seen from outside. */
  index: Uint32Array;
}

const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Central-difference gradient of f at (x, y, z), written into g. */
function gradient(f: Sdf, x: number, y: number, z: number, h: number, g: Float64Array): void {
  g[0] = (f(x + h, y, z) - f(x - h, y, z)) / (2 * h);
  g[1] = (f(x, y + h, z) - f(x, y - h, z)) / (2 * h);
  g[2] = (f(x, y, z + h) - f(x, y, z - h)) / (2 * h);
}

/**
 * Surface nets over a grid of `cell` metres. Each cell the surface passes through gets one
 * vertex, pulled onto the surface along the gradient, so the mesh follows the field rather
 * than the grid. Keep the shape inside `box` with a cell of margin, or it comes out open.
 */
export function isosurface(f: Sdf, box: Box, cell: number): Isosurface {
  const nx = Math.ceil((box.max[0] - box.min[0]) / cell) + 1;
  const ny = Math.ceil((box.max[1] - box.min[1]) / cell) + 1;
  const nz = Math.ceil((box.max[2] - box.min[2]) / cell) + 1;
  const [x0, y0, z0] = box.min;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) field[at(i, j, k)] = f(x0 + i * cell, y0 + j * cell, z0 + k * cell);
    }
  }

  // One vertex per cell that the surface crosses, at the mean of its edge crossings.
  const vertexOf = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cellAt = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        vertexOf[cellAt(i, j, k)] = pos.length / 3;
        pos.push(x0 + (i + sx / n) * cell, y0 + (j + sy / n) * cell, z0 + (k + sz / n) * cell);
      }
    }
  }

  // A quad for every grid edge with a sign change, joining the four cells around it.
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v = field[at(i, j, k)] < 0;
        if (v !== field[at(i + 1, j, k)] < 0) {
          quad(vertexOf[cellAt(i, j - 1, k - 1)], vertexOf[cellAt(i, j, k - 1)], vertexOf[cellAt(i, j, k)], vertexOf[cellAt(i, j - 1, k)], !v);
        }
        if (v !== field[at(i, j + 1, k)] < 0) {
          quad(vertexOf[cellAt(i - 1, j, k - 1)], vertexOf[cellAt(i - 1, j, k)], vertexOf[cellAt(i, j, k)], vertexOf[cellAt(i, j, k - 1)], !v);
        }
        if (v !== field[at(i, j, k + 1)] < 0) {
          quad(vertexOf[cellAt(i - 1, j - 1, k)], vertexOf[cellAt(i, j - 1, k)], vertexOf[cellAt(i, j, k)], vertexOf[cellAt(i - 1, j, k)], !v);
        }
      }
    }
  }

  // Pull each vertex onto the surface, then take the normal there.
  const count = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(count * 3);
  const g = new Float64Array(3);
  const h = cell * 0.05;
  for (let v = 0; v < count; v++) {
    let x = positions[v * 3];
    let y = positions[v * 3 + 1];
    let z = positions[v * 3 + 2];
    for (let it = 0; it < 3; it++) {
      const d = f(x, y, z);
      gradient(f, x, y, z, h, g);
      const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (g2 < 1e-12) break;
      // Never further than half a cell, so a vertex cannot jump to another sheet.
      const s = Math.max(-cell * 0.5, Math.min(cell * 0.5, d / Math.sqrt(g2))) / Math.sqrt(g2);
      x -= g[0] * s;
      y -= g[1] * s;
      z -= g[2] * s;
    }
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    gradient(f, x, y, z, h, g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    normals[v * 3] = g[0] / l;
    normals[v * 3 + 1] = g[1] / l;
    normals[v * 3 + 2] = g[2] / l;
  }
  return { positions, normals, index: new Uint32Array(idx) };
}

/** Polynomial smooth minimum: a union of two fields with a fillet about k wide. */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Smooth maximum: an intersection with a rounded edge about k wide. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Approximate distance to an axis-aligned ellipsoid at the origin (Quilez's bound). */
export function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  if (k0 < 1e-9) return -Math.min(rx, ry, rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return (k0 * (k0 - 1)) / k1;
}
