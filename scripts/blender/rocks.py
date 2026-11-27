"""Angular low-poly rocks for CycleBuddy: boulders, scree patches and cliff faces.

Run (from the repo root):
  blender -b --factory-startup --python scripts/blender/rocks.py -- [--preview DIR] [name ...]

Boulders are convex hulls of a jittered box whose corners are sliced off by a few
random planes, so they break into big flat facets like fractured limestone or granite
instead of the round blobs a noisy sphere gives. Faces facing up are lighter
(weathered, dusty), faces facing down darker, plus a small per-face jitter.

Sizes: boulders are about the size of the code-built rock in models.ts (2-3 m across
at instance scale 1; the terrain scales rocks 0.6-2.0). Scree patches are 4-6 m
across and under 0.8 m tall. Cliff faces are 10-20 m wide and 6-15 m tall, front
toward Blender -Y (three.js +Z), back open, base at z = 0.
"""

import math
import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import common as C  # noqa: E402

ROCK = C.hex_rgb(0x8e877d)        # terrainChunk alpine rock
ROCK_DARK = C.hex_rgb(0x6a635b)   # terrainChunk alpine rockDark
LIMESTONE = C.hex_rgb(0x9d978c)
GRANITE = C.hex_rgb(0x857f78)
SCREE = C.hex_rgb(0xb2aaa0)       # terrainChunk moor scree / alpine gravel range
SCREE_LIGHT = C.hex_rgb(0xc4bcae)
LEDGE_GREEN = C.hex_rgb(0x7f8a52)


def rock_light(up=0.12, down=0.3, tint=None, tint_above=0.75, tint_k=0.0):
    """Lighter tops, darker undersides. `tint` mixes a colour into faces facing almost
    straight up (grass or lichen on cliff ledges)."""
    def fn(pts, rgb):
        n = C.face_normal(pts)
        k = 1 + up * max(n.z, 0) - down * max(-n.z, 0)
        out = C.shade(rgb, k)
        if tint and n.z > tint_above:
            out = C.mix(out, tint, tint_k)
        return out
    return fn


def sliced_box(rng, size, cuts, extra=6, sharp=0.5):
    """Points of a jittered box (corners + some edge points), sliced by `cuts` random
    planes: every point past a plane is pushed back onto it. Returns the points.
    `sharp` is how deep a cut can go, as a fraction of the half-size."""
    hx, hy, hz = (s / 2 for s in size)
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                pts.append(Vector((sx * hx * (0.75 + rng.random() * 0.25), sy * hy * (0.75 + rng.random() * 0.25),
                                   sz * hz * (0.8 + rng.random() * 0.2))))
    for _ in range(extra):
        # Points on random box faces add facets between the corners.
        axis = rng.randrange(3)
        p = [rng.uniform(-hx, hx), rng.uniform(-hy, hy), rng.uniform(-hz, hz)]
        p[axis] = (hx, hy, hz)[axis] * (1 if rng.random() < 0.5 else -1) * (0.9 + rng.random() * 0.2)
        pts.append(Vector(p))
    for _ in range(cuts):
        # Mostly sideways and upward cuts: the ground hides the bottom anyway.
        a = rng.random() * math.tau
        el = rng.uniform(-0.15, 1.0)
        n = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el))).normalized()
        reach = max(abs(n.x) * hx + abs(n.y) * hy + abs(n.z) * hz, 1e-6)
        d = reach * (1 - sharp * (0.3 + rng.random() * 0.7))
        for p in pts:
            over = p.dot(n) - d
            if over > 0:
                p -= n * over
    return pts


def on_ground(pts, sink=0.0):
    """Flatten the bottom onto z = 0 (and optionally keep a bit below for a sunk look)."""
    zmin = min(p.z for p in pts)
    out = []
    for p in pts:
        z = p.z - zmin
        out.append((p.x, p.y, max(z, 0.0) - sink if z < 0.02 else z))
    return out


def boulder(name, seed, size, cuts, colour, extra=6, sharp=0.5, tilt=(0, 0), fragment=None):
    m = C.Model(name, seed)
    pts = sliced_box(m.rng, size, cuts, extra, sharp)
    pts = [Vector(p) for p in C.xform([tuple(p) for p in pts], tilt=tilt)]
    v, f = C.hull(on_ground(pts))
    m.add(v, f, colour, jitter=0.07, colour_fn=rock_light())
    if fragment:
        fsize, fcuts, (ox, oy) = fragment
        fp = sliced_box(m.rng, fsize, fcuts, 4, sharp)
        v, f = C.hull(on_ground(fp))
        m.add(C.xform(v, rot_z=m.rng.random() * 6, offset=(ox, oy, 0)), f, C.shade(colour, 0.95), jitter=0.07, colour_fn=rock_light())
    return m


def boulder_a():
    """Blocky limestone cube, corners knocked off."""
    return boulder('boulder_a', 201, (2.2, 1.8, 1.45), 8, LIMESTONE, extra=14)


def boulder_b():
    """Low wide slab with a sloped top."""
    return boulder('boulder_b', 202, (3.0, 2.0, 0.9), 8, ROCK, extra=14, tilt=(0.08, 0.05))


def boulder_c():
    """Tall leaning shard, like a block fallen off a face and stuck upright."""
    return boulder('boulder_c', 203, (1.5, 1.3, 2.3), 8, GRANITE, extra=14, sharp=0.55, tilt=(0.12, -0.18))


def boulder_d():
    """Split boulder: a big wedge with a smaller chunk broken off beside it."""
    return boulder('boulder_d', 204, (2.3, 1.7, 1.4), 7, ROCK, extra=12, tilt=(0.0, 0.15),
                   fragment=((1.0, 0.9, 0.7), 4, (1.45, 0.5)))


def boulder_e():
    """Chunky granite boulder, more facets, closer to round but still sharp-edged."""
    return boulder('boulder_e', 205, (2.0, 1.9, 1.5), 11, GRANITE, extra=18, sharp=0.4)


def scree_patch(name, seed, count, radius):
    """A loose spread of small angular stones as one mesh, flat footprint."""
    m = C.Model(name, seed)
    placed = []
    tries = 0
    while len(placed) < count and tries < 400:
        tries += 1
        a = m.rng.random() * math.tau
        r = radius * math.sqrt(m.rng.random())
        x, y = math.cos(a) * r * 1.1, math.sin(a) * r * 0.9
        s = 0.25 + m.rng.random() * 0.45 * (1 - r / radius * 0.5)
        if any((x - px) ** 2 + (y - py) ** 2 < (s + ps) ** 2 * 0.55 for px, py, ps in placed):
            continue
        placed.append((x, y, s))
    for i, (x, y, s) in enumerate(placed):
        pts = sliced_box(m.rng, (s * 2.0, s * 1.6, s * 0.6), 3, extra=0, sharp=0.6)
        v, f = C.hull(on_ground(pts, sink=0.0))
        # Sink a little so stones bed into the ground instead of resting on a point.
        v = C.xform(v, rot_z=m.rng.random() * math.tau, tilt=(m.rng.uniform(-0.15, 0.15), m.rng.uniform(-0.15, 0.15)), offset=(x, y, -0.06 * s))
        colour = C.mix(SCREE, SCREE_LIGHT, m.rng.random()) if i % 3 else C.shade(SCREE, 0.85)
        m.add(v, f, colour, jitter=0.06, colour_fn=rock_light(up=0.08, down=0.25))
    return m


def scree_patch_a():
    return scree_patch('scree_patch_a', 301, 12, 2.3)


def scree_patch_b():
    return scree_patch('scree_patch_b', 302, 12, 2.6)


def cliff_face(name, seed, width, rows, cols, curve=1.2):
    """A rock face segment from a vertical profile of (z, depth) rows; depth grows
    backwards (+Y). Close rows with a big depth jump make ledges. Each vertex is
    jittered except on the end columns, which stay planar so the side walls are flat.
    Side walls and a top run back to a flat back plane; the back itself is open
    (never visible from the front or sides)."""
    m = C.Model(name, seed)
    rng = m.rng
    back = max(d for _, d in rows) + 2.5
    xs = [-width / 2 + width * i / (cols - 1) for i in range(cols)]
    # Buttresses and gullies: a depth offset per column shared by every row, so the
    # face has vertical structure instead of a uniform triangle mosaic.
    ribs = [0.0 if c in (0, cols - 1) else rng.uniform(-1.1, 1.1) for c in range(cols)]
    verts = []
    for ri, (z, d) in enumerate(rows):
        for ci, x in enumerate(xs):
            edge = ci in (0, cols - 1)
            jx = 0 if edge else rng.uniform(-0.35, 0.35) * width / cols
            top = ri == len(rows) - 1
            jz = 0 if ri == 0 else rng.uniform(-1.3, 1.0) if top else rng.uniform(-0.3, 0.3)
            jd = rng.uniform(-0.6, 0.6) if ri > 0 else rng.uniform(-0.2, 0.2)
            bend = curve * (2 * x / width) ** 2
            rib = ribs[ci] * (0.4 if ri == 0 else 1.0)
            verts.append((x + jx, d + jd + bend + rib, max(0.0, z + jz)))
    nr, nc = len(rows), cols
    idx = lambda r, c: r * nc + c  # noqa: E731
    faces = []
    for r in range(nr - 1):
        for c in range(nc - 1):
            # Two triangles per cell, diagonal alternating, so the facets do not all lean one way.
            a, b, cc, dd = idx(r, c), idx(r, c + 1), idx(r + 1, c + 1), idx(r + 1, c)
            if (r + c) % 2:
                faces += [(a, b, cc), (a, cc, dd)]
            else:
                faces += [(a, b, dd), (b, cc, dd)]
    # Top: the last row runs back to the back plane.
    top_z = [verts[idx(nr - 1, c)][2] for c in range(nc)]
    base = len(verts)
    for c in range(nc):
        verts.append((verts[idx(nr - 1, c)][0], back, top_z[c] - 0.3))
    for c in range(nc - 1):
        faces.append((idx(nr - 1, c), idx(nr - 1, c + 1), base + c + 1, base + c))
    # Side walls (planar n-gons: end columns have no x jitter).
    for c, flip in ((0, True), (nc - 1, False)):
        ring = [idx(r, c) for r in range(nr)] + [base + c]
        verts.append((verts[idx(0, c)][0], back, 0.0))
        ring.append(len(verts) - 1)
        faces.append(tuple(ring) if flip else tuple(reversed(ring)))
    strata = [C.shade(ROCK, 1 + rng.uniform(-0.06, 0.06)) for _ in rows]

    def colour_fn(pts, rgb):
        n = C.face_normal(pts)
        zc = sum(p.z for p in pts) / len(pts)
        band = min(range(len(rows)), key=lambda i: abs(rows[i][0] - zc))
        base_rgb = strata[band]
        if n.z < 0.35:
            base_rgb = C.mix(base_rgb, ROCK_DARK, 0.35 * (1 - max(n.z, 0) / 0.35))
        return rock_light(up=0.15, down=0.3, tint=LEDGE_GREEN, tint_above=0.7, tint_k=0.45)(pts, base_rgb)

    m.add(verts, faces, ROCK, jitter=0.05, colour_fn=colour_fn, check=False)
    return m


def cliff_face_a():
    """14 m wide, 9 m tall, one clear ledge halfway."""
    rows = [(0, 0), (2.2, 0.5), (4.3, 1.0), (4.6, 2.4), (6.8, 2.9), (9.0, 3.6)]
    return cliff_face('cliff_face_a', 401, 14, rows, 7)


def cliff_face_b():
    """18 m wide, 13.5 m tall, two ledges, steeper upper wall."""
    rows = [(0, 0), (2.5, 0.6), (4.6, 1.1), (4.9, 2.6), (7.6, 3.0), (9.8, 3.4), (10.1, 4.8), (13.5, 5.3)]
    return cliff_face('cliff_face_b', 402, 18, rows, 7, curve=1.6)


def cliff_face_c():
    """11 m wide, 7 m tall, a low band with a slight overhang under the top."""
    rows = [(0, 0), (1.8, 0.4), (3.6, 0.6), (3.8, 1.9), (5.6, 1.6), (7.0, 2.6)]
    return cliff_face('cliff_face_c', 403, 11, rows, 6, curve=0.8)


BUILDERS = {
    'boulder_a': boulder_a,
    'boulder_b': boulder_b,
    'boulder_c': boulder_c,
    'boulder_d': boulder_d,
    'boulder_e': boulder_e,
    'scree_patch_a': scree_patch_a,
    'scree_patch_b': scree_patch_b,
    'cliff_face_a': cliff_face_a,
    'cliff_face_b': cliff_face_b,
    'cliff_face_c': cliff_face_c,
}


def main():
    a = C.args()
    preview = None
    if '--preview' in a:
        i = a.index('--preview')
        preview = a[i + 1]
        del a[i:i + 2]
    names = a or list(BUILDERS)
    models = [BUILDERS[n]() for n in names]
    C.export_models(models)
    if preview:
        os.makedirs(preview, exist_ok=True)
        groups = {
            'boulders': [m for m in models if m.name.startswith('boulder')],
            'scree': [m for m in models if m.name.startswith('scree')],
            'cliffs': [m for m in models if m.name.startswith('cliff')],
        }
        for key, ms in groups.items():
            if ms:
                C.render_sheet(ms, os.path.join(preview, f'rocks_{key}.png'), width=1600, height=600, elevation=14)


if __name__ == '__main__':
    main()
