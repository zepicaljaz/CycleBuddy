"""Region-specific low-poly trees for CycleBuddy.

Run (from the repo root):
  blender -b --factory-startup --python scripts/blender/trees.py -- [--preview DIR] [name ...]

Writes src/assets/models/<name>.glb and <name>_far.glb (about 40 % of the triangles,
used on far terrain chunks). Sizes follow the code-built trees in src/world/models.ts:
a tall tree is 9-12 m at instance scale 1; the terrain scales each instance 0.75-1.35
and stretches its height another 0.85-1.35.

Colours are sRGB hex like models.ts and are stored linear (see common.hex_rgb).
Foliage faces are lit a little by their normal (tops lighter, undersides darker) and
get a small per-face brightness jitter, so a crown reads as faceted, not one flat green.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common as C  # noqa: E402

TRUNK = C.hex_rgb(0x6b4a32)        # models.ts pine trunk
TRUNK_DARK = C.hex_rgb(0x5a4030)   # models.ts spruce trunk
BEECH_BARK = C.hex_rgb(0x8c877c)   # smooth grey beech bark
PINE_BARK_TOP = C.hex_rgb(0xa8643a)  # orange upper trunk of a Scots pine


def foliage_light(up=0.08, down=0.16, gradient=None):
    """Tint by face normal (tops lighter, undersides darker) and, optionally, height:
    `gradient=(z0, z1, k)` brightens linearly by up to k from z0 to z1, like the
    lighter upper tiers of the code-built conifers."""
    def fn(pts, rgb):
        n = C.face_normal(pts)
        k = 1 + up * max(n.z, 0) - down * max(-n.z, 0)
        if gradient:
            z0, z1, g = gradient
            zc = sum(p.z for p in pts) / len(pts)
            k *= 1 + g * min(max((zc - z0) / (z1 - z0), 0), 1)
        return C.shade(rgb, k)
    return fn


def trunk(m, n, r0, r1, z0, z1, colour, tilt=(0, 0), offset=(0, 0, 0), cap=False):
    v, f = C.frustum(n, r0, r1, z0, z1, m.rng, wobble=0.08, cap_top=cap, phase=m.rng.random())
    m.add(C.xform(v, tilt=tilt, offset=offset), f, colour, jitter=0.05)


def tier_stack(m, tiers, n, colours, droop_k=0.22, wobble=0.12, light=None):
    """Conifer tiers bottom to top: (z_base, height, radius)."""
    for i, (zb, h, r) in enumerate(tiers):
        v, f = C.star_cone(n, r, r * 0.62, zb, zb + h, r * droop_k, m.rng, wobble=wobble, phase=m.rng.random() * 2)
        m.add(v, f, colours[min(i, len(colours) - 1)], jitter=0.06, colour_fn=light, check=False)


# ---------------------------------------------------------------- conifers

def spruce_a(far=False):
    """Norway spruce: a full, dark cone of drooping tiers right down to the ground. The
    lowest branch tips sweep down to the ground, so only a stub of trunk shows; eight
    overlapping tiers keep the crown dense, with no daylight between them."""
    m = C.Model('spruce_a_far' if far else 'spruce_a', 101)
    greens = [C.hex_rgb(h) for h in (0x1c4428, 0x1f4a2d, 0x214e30, 0x244f31, 0x275836, 0x2a5c3a, 0x2d6240, 0x30663f)]
    light = foliage_light(gradient=(0.75, 10.5, 0.08))
    if far:
        trunk(m, 4, 0.28, 0.16, 0, 1.0, TRUNK_DARK)
        tiers = [(0.75, 3.4, 2.55), (2.7, 3.4, 1.95), (4.9, 3.2, 1.35), (7.0, 3.5, 0.75)]
        tier_stack(m, tiers, 4, greens[::2], light=light)
    else:
        trunk(m, 5, 0.28, 0.16, 0, 1.0, TRUNK_DARK)
        tiers = [(0.75, 2.2, 2.6), (1.7, 2.2, 2.35), (2.7, 2.1, 2.05), (3.75, 2.05, 1.75),
                 (4.8, 2.0, 1.45), (5.9, 1.9, 1.15), (7.0, 1.9, 0.82), (8.1, 2.4, 0.5)]
        tier_stack(m, tiers, 6, greens, light=light)
    return m


def spruce_b(far=False):
    """Narrow high-altitude spruce: a tall dark spire, a bit over half the width of
    spruce_a, green from about 0.5 m up with tightly stacked tiers."""
    m = C.Model('spruce_b_far' if far else 'spruce_b', 102)
    greens = [C.hex_rgb(h) for h in (0x1a3f2c, 0x1c432e, 0x1d4630, 0x204b33, 0x234f36, 0x26553a, 0x2a5b3e, 0x2e6142)]
    light = foliage_light(gradient=(0.65, 11.5, 0.08))
    if far:
        trunk(m, 4, 0.24, 0.14, 0, 1.1, TRUNK_DARK)
        tiers = [(0.65, 3.8, 1.7), (3.0, 3.7, 1.3), (5.6, 3.5, 0.92), (8.0, 3.6, 0.5)]
        tier_stack(m, tiers, 4, greens[::2], droop_k=0.3, light=light)
    else:
        trunk(m, 5, 0.24, 0.14, 0, 1.1, TRUNK_DARK)
        tiers = [(0.65, 2.5, 1.72), (1.8, 2.5, 1.55), (3.0, 2.4, 1.38), (4.25, 2.3, 1.2),
                 (5.5, 2.2, 1.02), (6.7, 2.1, 0.83), (7.9, 2.1, 0.62), (9.0, 2.6, 0.38)]
        tier_stack(m, tiers, 5, greens, droop_k=0.3, light=light)
    return m


def larch(far=False):
    """European larch: light yellow-green whorls from about 1.2 m up, a straight
    leader, and a little trunk showing between the whorls. Reads lighter and airier
    than spruce, but as a full crown, not a pole with a few branches."""
    m = C.Model('larch_far' if far else 'larch', 103)
    greens = [C.hex_rgb(h) for h in (0x6f8f3e, 0x739340, 0x779741, 0x7d9b46, 0x83a04b, 0x88a650, 0x8eab55, 0x93b05a)]
    light = foliage_light(up=0.1, down=0.2)
    if far:
        trunk(m, 4, 0.3, 0.06, 0, 10.2, TRUNK, cap=False)
        tiers = [(1.2, 2.2, 2.25), (3.6, 2.0, 1.75), (5.9, 1.8, 1.2), (8.0, 2.2, 0.6)]
        tier_stack(m, tiers, 4, greens[::2], droop_k=0.22, wobble=0.25, light=light)
    else:
        trunk(m, 5, 0.3, 0.05, 0, 10.4, TRUNK, cap=False)
        tiers = [(1.2, 1.1, 2.3), (2.25, 1.05, 2.1), (3.3, 1.0, 1.88), (4.35, 0.95, 1.64),
                 (5.4, 0.9, 1.38), (6.4, 0.85, 1.1), (7.4, 0.85, 0.8), (8.4, 1.6, 0.45)]
        tier_stack(m, tiers, 5, greens, droop_k=0.22, wobble=0.3, light=light)
    return m


def mugo(far=False):
    """Dwarf mountain pine (krummholz): no single trunk, a low wide mound of dark
    clumps on short stems leaning out. About 1.6 m tall and 3.5 m across."""
    m = C.Model('mugo_far' if far else 'mugo', 104)
    greens = [C.hex_rgb(h) for h in (0x27502e, 0x2c5732, 0x305d35, 0x2a5330)]
    light = foliage_light(up=0.1, down=0.25)
    stems = 2 if far else 5
    for i in range(stems):
        a = i / stems * math.tau + m.rng.random() * 0.6
        lean = 0.75 + m.rng.random() * 0.25
        length = 1.0 + m.rng.random() * 0.35
        tip = (math.cos(a) * math.sin(lean) * length, math.sin(a) * math.sin(lean) * length, math.cos(lean) * length)
        if not far:
            v, f = C.frustum(4, 0.09, 0.05, 0, length, m.rng, cap_top=False)
            # Tilt toward the tip direction: about Y by `lean`, then spin to angle a.
            m.add(C.xform(v, tilt=(0, lean), rot_z=a), f, C.hex_rgb(0x4e3a2a), jitter=0.05)
        r = 0.8 + m.rng.random() * 0.25
        v, f = C.blob(m.rng, r, (1.3, 1.15, 0.85), wobble=0.2, flat_bottom=0.55)
        # Clumps sit low over the stem tips so the mound reaches the ground.
        m.add(C.xform(v, rot_z=m.rng.random() * 6, offset=(tip[0] * 0.95, tip[1] * 0.95, tip[2] * 0.75)), f, greens[i % len(greens)], jitter=0.07, colour_fn=light)
    v, f = C.blob(m.rng, 1.0, (1.2, 1.2, 0.9), wobble=0.15, flat_bottom=0.5)
    m.add(C.xform(v, offset=(0, 0, 0.95)), f, greens[2], jitter=0.07, colour_fn=light)
    return m


def scots_pine(far=False):
    """Scots pine: a bare trunk going orange near the top, a slight lean, and a
    layered blue-green crown over the upper half, lopsided to one side."""
    m = C.Model('scots_pine_far' if far else 'scots_pine', 105)
    crown = [C.hex_rgb(h) for h in (0x355a3a, 0x3b6240, 0x416a42, 0x38603d)]
    light = foliage_light(up=0.08, down=0.2)
    lean = (0.04, 0.03)
    n = 4 if far else 5
    trunk(m, n, 0.32, 0.22, 0, 3.6, TRUNK, tilt=lean)
    top = C.xform([(0, 0, 3.6)], tilt=lean)[0]
    trunk(m, n, 0.22, 0.12, 3.6, 9.6, PINE_BARK_TOP, tilt=lean, offset=(0, 0, 0))
    # Clumps from about 5.5 m up: the lowest ones wide and to the sides, the top one small.
    clumps = [((0.2, 0.1, 9.4), 2.3, 0.75), ((-1.2, 0.6, 7.4), 2.0, 0.6), ((1.1, -0.6, 6.4), 1.8, 0.55)] if far else [
        ((0.3, 0.1, 10.3), 1.7, 0.55), ((-1.4, 0.8, 9.2), 1.6, 0.5), ((1.5, -0.8, 8.6), 1.6, 0.5),
        ((0.4, 1.3, 7.5), 1.7, 0.5), ((-1.2, -0.9, 6.7), 1.6, 0.5), ((1.3, 0.5, 6.0), 1.5, 0.45)]
    for i, ((x, y, z), r, flat) in enumerate(clumps):
        v, f = C.blob(m.rng, r, (1.35, 1.2, flat), wobble=0.22, flat_bottom=0.3)
        k = (z - 3.6) / 6.0  # follow the lean up the trunk
        m.add(C.xform(v, rot_z=m.rng.random() * 6, offset=(x + top[0] * 2.3 * k, y + top[1] * 2.3 * k, z)), f, crown[i % len(crown)], jitter=0.07, colour_fn=light)
    if not far:
        # Two bare limbs reaching into the lower side clumps.
        for (dx, dy, z0, z1) in ((-1.3, 0.6, 6.0, 7.2), (1.3, 0.5, 5.2, 6.1)):
            v, f = C.frustum(4, 0.09, 0.05, 0, 1, m.rng, cap_top=False)
            length = math.sqrt(dx * dx + dy * dy + (z1 - z0) ** 2)
            pitch = math.acos((z1 - z0) / length)
            m.add(C.xform(v, scale=(1, 1, length), tilt=(0, pitch), rot_z=math.atan2(dy, dx), offset=(top[0] * 2, top[1] * 2, z0)), f, PINE_BARK_TOP, jitter=0.05)
    return m


def aleppo_pine(far=False):
    """Mediterranean pine (Aleppo / stone pine): a forked trunk under a wide, flat,
    irregular umbrella crown. About 9 m tall and 8 m across."""
    m = C.Model('aleppo_pine_far' if far else 'aleppo_pine', 106)
    crown = C.hex_rgb(0x4f6e36)
    light = foliage_light(up=0.1, down=0.22)
    n = 4 if far else 5
    # The far version has no limbs, so its trunk runs up into the crown instead.
    trunk(m, n, 0.36, 0.2 if far else 0.24, 0, 6.4 if far else 4.2, C.hex_rgb(0x5e4a3a), tilt=(0.06, 0))
    if not far:
        for a in (0.4, 2.5, 4.4):
            v, f = C.frustum(4, 0.18, 0.1, 0, 2.6, m.rng, cap_top=False)
            m.add(C.xform(v, tilt=(0, 0.55), rot_z=a, offset=(0, 0.25, 4.0)), f, C.hex_rgb(0x5e4a3a), jitter=0.05)
    seg = 6 if far else 9
    profile = [(0, 6.0), (3.9, 6.4), (4.2, 7.2), (2.9, 8.2), (0, 8.5)] if not far else [(0, 6.0), (4.0, 6.6), (3.0, 8.0), (0, 8.4)]
    v, f = C.lathe(profile, seg, m.rng, wobble=0.16, phase=m.rng.random())
    v = C.xform(v, scale=(1.05, 0.9, 1), offset=(0, 0.25, 0))
    m.add(v, f, crown, jitter=0.07, colour_fn=light)
    if not far:
        for (x, y, z, r, c) in ((1.6, 1.0, 8.1, 1.5, 0x557538), (-1.8, -0.6, 7.9, 1.4, 0x4a6834)):
            bv, bf = C.blob(m.rng, r, (1.4, 1.2, 0.55), wobble=0.2, flat_bottom=0.2)
            m.add(C.xform(bv, offset=(x, y, z)), bf, C.hex_rgb(c), jitter=0.07, colour_fn=light)
    return m


def cypress(far=False):
    """Italian cypress: a dark, narrow flame. 11 m tall, under 2 m across."""
    m = C.Model('cypress_far' if far else 'cypress', 107)
    green = C.hex_rgb(0x2b4a2c)
    light = foliage_light(up=0.06, down=0.2, gradient=(0, 11, 0.1))
    if far:
        # Open bottom ring at ground level (the terrain sinks trees 0.3 m), not a point.
        profile = [(0.5, 0.0), (0.9, 1.6), (0.95, 5.0), (0.5, 8.8), (0, 11.0)]
        v, f = C.lathe(profile, 5, m.rng, wobble=0.1)
    else:
        trunk(m, 4, 0.2, 0.16, 0, 1.0, TRUNK_DARK)
        profile = [(0, 0.55), (0.7, 1.1), (0.95, 2.4), (1.02, 4.2), (0.95, 6.0), (0.78, 7.8), (0.52, 9.4), (0.22, 10.5), (0, 11.2)]
        v, f = C.lathe(profile, 7, m.rng, wobble=0.12)
    m.add(v, f, green, jitter=0.07, colour_fn=light)
    return m


# ---------------------------------------------------------------- broadleaf

def crown_blobs(m, blobs, colours, light, flat=None):
    for i, ((x, y, z), r, s) in enumerate(blobs):
        v, f = C.blob(m.rng, r, s, wobble=0.18, flat_bottom=flat)
        m.add(C.xform(v, rot_z=m.rng.random() * 6, offset=(x, y, z)), f, colours[i % len(colours)], jitter=0.07, colour_fn=light)


def beech(far=False):
    """European beech: smooth grey trunk, a big fresh-green crown from about 3 m up,
    built from overlapping clumps, widest low down. About 11 m."""
    m = C.Model('beech_far' if far else 'beech', 108)
    greens = [C.hex_rgb(h) for h in (0x5f8f37, 0x6c9c3d, 0x56853a, 0x649439)]
    light = foliage_light(up=0.1, down=0.22)
    trunk(m, 4 if far else 6, 0.36, 0.2, 0, 4.6, BEECH_BARK)
    if far:
        blobs = [((0, 0, 6.6), 3.4, (1, 1, 0.95)), ((0.6, -0.4, 9.0), 2.4, (1, 1, 0.9)), ((-1.2, 0.8, 5.0), 2.3, (1.1, 1, 0.8))]
    else:
        for a in (0.3, 3.4):
            v, f = C.frustum(4, 0.16, 0.08, 0, 2.2, m.rng, cap_top=False)
            m.add(C.xform(v, tilt=(0, 0.5), rot_z=a, offset=(0, 0, 3.4)), f, BEECH_BARK, jitter=0.05)
        blobs = [((0, 0, 6.8), 3.0, (1, 1, 0.9)), ((1.8, 0.6, 5.2), 2.2, (1, 1, 0.8)), ((-1.7, -0.7, 5.4), 2.3, (1, 1, 0.8)),
                 ((0.4, 1.6, 4.6), 1.9, (1, 1, 0.75)), ((0.5, -1.5, 8.4), 2.1, (1, 1, 0.9)), ((-0.6, 1.3, 8.8), 2.0, (1, 1, 0.9)),
                 ((0.2, 0.1, 10.2), 1.7, (1, 1, 0.85))]
    crown_blobs(m, blobs, greens, light)
    return m


def holm_oak(far=False):
    """Holm oak: short trunk, a dense, round, dark grey-green crown nearly to the
    ground. About 7 m tall and 7 m across."""
    m = C.Model('holm_oak_far' if far else 'holm_oak', 109)
    greens = [C.hex_rgb(h) for h in (0x3e5a30, 0x46623a, 0x384f2c, 0x42603a)]
    light = foliage_light(up=0.1, down=0.25)
    trunk(m, 4 if far else 5, 0.4, 0.28, 0, 2.6, C.hex_rgb(0x4e4034))
    if far:
        blobs = [((0, 0, 4.4), 3.2, (1.1, 1.05, 0.85)), ((0.4, 0.3, 5.8), 2.2, (1, 1, 0.9))]
    else:
        blobs = [((0, 0, 4.4), 2.9, (1.1, 1.05, 0.85)), ((1.7, 0.4, 3.8), 1.9, (1, 1, 0.85)), ((-1.6, -0.5, 3.9), 2.0, (1, 1, 0.85)),
                 ((0.3, 1.6, 4.0), 1.8, (1, 1, 0.85)), ((0.2, -0.2, 5.8), 2.1, (1, 1, 0.85))]
    crown_blobs(m, blobs, greens, light, flat=0.45)
    return m


BUILDERS = {
    'spruce_a': spruce_a,
    'spruce_b': spruce_b,
    'larch': larch,
    'mugo': mugo,
    'scots_pine': scots_pine,
    'aleppo_pine': aleppo_pine,
    'cypress': cypress,
    'beech': beech,
    'holm_oak': holm_oak,
}


def main():
    a = C.args()
    preview = None
    if '--preview' in a:
        i = a.index('--preview')
        preview = a[i + 1]
        del a[i:i + 2]
    names = a or list(BUILDERS)
    near = [BUILDERS[n](False) for n in names]
    far = [BUILDERS[n](True) for n in names]
    C.export_models(near + far)
    if preview:
        os.makedirs(preview, exist_ok=True)
        C.render_sheet(near, os.path.join(preview, 'trees.png'))
        C.render_sheet(far, os.path.join(preview, 'trees_far.png'))
        # Roughly how big a tree is at 30 m on a laptop screen: a few dozen pixels.
        C.render_sheet(near, os.path.join(preview, 'trees_small.png'), width=640, height=170, label=False)


if __name__ == '__main__':
    main()
