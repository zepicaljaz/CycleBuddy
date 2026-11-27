"""Low-poly landmarks for the real roads: the Russian Chapel on Vršič, two mountain-hut
variants, a wayside shrine and a wayside cross.

Run (from the repo root):
  blender -b --factory-startup --python scripts/blender/landmarks.py -- [--preview DIR] [name ...]

Built from boxes, gable prisms and lathed onion domes, one flat colour per face, like
trees.py and rocks.py. Placed by src/world/landmarks.ts at the OpenStreetMap positions in
src/routes/real/landmarks.json (scripts/real-track/landmarks.mjs).

Axes: Blender Z up, metres, origin at the ground centre of the footprint, base on z = 0.
The long axis is Blender +X (three.js +X). The front of a hut (balcony, door) faces
Blender -Y = three.js +Z: the game turns that side toward the road. The chapel's door
is at its +X end (its porch tower); the game turns that end toward the road.
Walls start 0.6 m below z = 0 so a building on a slope has no gap under its downhill side.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common as C  # noqa: E402

# Palette: sRGB hex, converted to linear by C.hex_rgb.
WOOD_DARK = C.hex_rgb(0x4b3727)     # weathered larch logs, the chapel
WOOD = C.hex_rgb(0x6b4c32)          # hut upper floor boards
WOOD_LIGHT = C.hex_rgb(0x8a6a48)    # balcony, trim
SHINGLE = C.hex_rgb(0x6c6964)       # grey larch shingles
SHINGLE_DARK = C.hex_rgb(0x55524e)
DOME = C.hex_rgb(0x3b3734)          # dark shingled onion domes
STONE = C.hex_rgb(0x9a948a)         # ground floor masonry (alpine rock range)
STONE_DARK = C.hex_rgb(0x7d776e)
PLASTER = C.hex_rgb(0xe6e1d6)       # whitewashed shrine
WINDOW = C.hex_rgb(0x2a2e33)
SHUTTER = C.hex_rgb(0x4f6a3a)       # green shutters
CROSS = C.hex_rgb(0x2f2a26)
GILT = C.hex_rgb(0xb89a52)          # cross tops on the domes
NICHE = C.hex_rgb(0x3d4a6a)         # painted blue niche

SINK = 0.6


def lit(up=0.1, down=0.25):
    """Tops lighter, undersides darker (the eaves read from the road below)."""
    def fn(pts, rgb):
        n = C.face_normal(pts)
        return C.shade(rgb, 1 + up * max(n.z, 0) - down * max(-n.z, 0))
    return fn


def box(x0, x1, y0, y1, z0, z1, bottom=False):
    """Axis box, outward winding. No bottom face unless asked: the ground hides it."""
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
    if bottom:
        f.append((0, 3, 2, 1))
    return v, f


def gable(x0, x1, y0, y1, z_eave, z_ridge):
    """Gable roof, ridge along X, with an underside so the eaves are not see-through
    from below (three.js culls back faces)."""
    ym = (y0 + y1) / 2
    v = [(x0, y0, z_eave), (x1, y0, z_eave), (x1, y1, z_eave), (x0, y1, z_eave),
         (x0, ym, z_ridge), (x1, ym, z_ridge)]
    f = [(0, 1, 5, 4), (2, 3, 4, 5), (3, 0, 4), (1, 2, 5), (0, 3, 2, 1)]
    return v, f


def gable_y(x0, x1, y0, y1, z_eave, z_ridge):
    """Gable roof with the ridge along Y, so its triangle faces -Y (the road): the
    gable roof turned a quarter about Z, (x, y) -> (-y, x), which keeps the winding."""
    v, f = gable(y0, y1, -x1, -x0, z_eave, z_ridge)
    return [(-y, x, z) for x, y, z in v], f


def gable_wall(x, y0, y1, z0, z1, sign):
    """Triangular gable end wall at x, facing +X (sign 1) or -X (sign -1)."""
    ym = (y0 + y1) / 2
    v = [(x, y0, z0), (x, y1, z0), (x, ym, z1)]
    f = [(0, 1, 2)] if sign > 0 else [(1, 0, 2)]
    return v, f


def hip(x0, x1, y0, y1, z_eave, z_ridge, inset):
    """Hipped roof: ridge along X, shortened by `inset` at both ends, with an underside."""
    ym = (y0 + y1) / 2
    v = [(x0, y0, z_eave), (x1, y0, z_eave), (x1, y1, z_eave), (x0, y1, z_eave),
         (x0 + inset, ym, z_ridge), (x1 - inset, ym, z_ridge)]
    f = [(0, 1, 5, 4), (2, 3, 4, 5), (3, 0, 4), (1, 2, 5), (0, 3, 2, 1)]
    return v, f


def pyramid(cx, cy, half, z0, z1, n=4, phase=math.pi / 4):
    """n-sided pyramid roof (tent roof on a tower), with an underside."""
    v = [(cx + math.cos(phase + i / n * math.tau) * half, cy + math.sin(phase + i / n * math.tau) * half, z0)
         for i in range(n)] + [(cx, cy, z1)]
    f = [(i, (i + 1) % n, n) for i in range(n)] + [tuple(range(n - 1, -1, -1))]
    return v, f


def prism(n, r, z0, z1, cx=0.0, cy=0.0, phase=0.0, cap=True):
    """n-sided upright prism (tower drum), top capped."""
    v, f = C.frustum(n, r, r, z0, z1, cap_top=cap, phase=phase)
    return [(x + cx, y + cy, z) for x, y, z in v], f


def onion(m, cx, cy, z0, r, h, n, colour):
    """Onion dome: neck, a bulge wider than the drum, a pinched tip, plus a cross."""
    prof = [(r * 0.55, 0.0), (r * 1.0, h * 0.22), (r * 1.05, h * 0.4), (r * 0.75, h * 0.62),
            (r * 0.25, h * 0.84), (0.0, h)]
    v, f = C.lathe(prof, n, m.rng, phase=math.pi / n)
    m.add([(x + cx, y + cy, z + z0) for x, y, z in v], f, colour, jitter=0.05, colour_fn=lit(0.15, 0.3), check=False)
    # Cross: a post and a bar, thin boxes.
    top = z0 + h
    m.add(*box(cx - 0.05, cx + 0.05, cy - 0.05, cy + 0.05, top - 0.1, top + 0.9), GILT, check=False)
    m.add(*box(cx - 0.05, cx + 0.05, cy - 0.32, cy + 0.32, top + 0.5, top + 0.6), GILT, check=False)


def windows_on_wall(m, axis, at, centres, z0, z1, half, out, colour=WINDOW, shutters=False):
    """Small dark panes slightly proud of a wall. axis 'y': the wall is at y = at,
    facing -Y if out < 0 else +Y; centres are x positions. axis 'x': wall at x = at."""
    for c in centres:
        if axis == 'y':
            y0, y1 = sorted((at, at + out))
            m.add(*box(c - half, c + half, y0, y1, z0, z1), colour, jitter=0.03, check=False)
            if shutters:
                for s in (-1, 1):
                    xa = c + s * (half + 0.05)
                    xb = c + s * (half + 0.05 + half * 0.9)
                    m.add(*box(min(xa, xb), max(xa, xb), y0, y1, z0, z1), SHUTTER, jitter=0.04, check=False)
        else:
            x0, x1 = sorted((at, at + out))
            m.add(*box(x0, x1, c - half, c + half, z0, z1), colour, jitter=0.03, check=False)


# ---------------------------------------------------------------- Russian Chapel

def ruska_kapelica():
    """The Russian Chapel on Vršič (1916): a dark log chapel on a stone plinth, a steep
    shingled nave roof, an octagonal drum with the big onion dome over the nave, and a
    smaller onion-domed tower over the porch at the door end (+X). OSM outline is about
    8.4 x 6 m."""
    m = C.Model('ruska_kapelica', 1916)
    L, W = 8.0, 5.2           # nave + porch along X, width along Y
    hx, hy = L / 2, W / 2
    plinth = 0.7
    # Stone plinth (the chapel stands on a sloping forest floor).
    m.add(*box(-hx - 0.2, hx + 0.2, -hy - 0.2, hy + 0.2, -SINK, plinth), STONE, jitter=0.05, colour_fn=lit())
    # Log walls: the nave, and a narrower porch block at +X.
    wall_top = plinth + 3.1
    nave_x1 = hx - 1.8
    m.add(*box(-hx, nave_x1, -hy, hy, plinth, wall_top), WOOD_DARK, jitter=0.06)
    m.add(*box(nave_x1, hx, -hy + 0.9, hy - 0.9, plinth, wall_top - 0.5), WOOD_DARK, jitter=0.06)
    # Log courses read as darker bands: two thin strips proud of the long walls.
    for z in (plinth + 1.1, plinth + 2.2):
        m.add(*box(-hx - 0.05, nave_x1 + 0.05, -hy - 0.06, -hy, z, z + 0.12), C.shade(WOOD_DARK, 0.75), check=False)
        m.add(*box(-hx - 0.05, nave_x1 + 0.05, hy, hy + 0.06, z, z + 0.12), C.shade(WOOD_DARK, 0.75), check=False)
    # Steep nave roof (about 55 degrees) and its gable ends.
    ridge = wall_top + 3.4
    m.add(*gable(-hx - 0.5, nave_x1 + 0.3, -hy - 0.55, hy + 0.55, wall_top - 0.15, ridge), SHINGLE, jitter=0.05, colour_fn=lit())
    m.add(*gable_wall(-hx, -hy, hy, wall_top, ridge - 0.3, -1), WOOD_DARK, jitter=0.04)
    m.add(*gable_wall(nave_x1, -hy, hy, wall_top, ridge - 0.3, 1), WOOD_DARK, jitter=0.04)
    # Porch roof, lower.
    porch_top = wall_top - 0.5
    m.add(*gable(nave_x1 - 0.1, hx + 0.45, -hy + 0.45, hy - 0.45, porch_top - 0.1, porch_top + 1.7), SHINGLE_DARK, jitter=0.05, colour_fn=lit())
    m.add(*gable_wall(hx, -hy + 0.9, hy - 0.9, porch_top, porch_top + 1.45, 1), WOOD_DARK, jitter=0.04)
    # Door and windows.
    m.add(*box(hx, hx + 0.08, -0.55, 0.55, plinth, plinth + 2.1), WINDOW, check=False)
    windows_on_wall(m, 'y', -hy, (-2.6, -0.8), plinth + 1.3, plinth + 2.3, 0.3, -0.07)
    windows_on_wall(m, 'y', hy, (-2.6, -0.8), plinth + 1.3, plinth + 2.3, 0.3, 0.07)
    # Main tower: octagonal drum through the nave ridge, a short tent roof, the big dome.
    tx = -1.1
    drum0, drum1 = ridge - 1.6, ridge + 1.5
    m.add(*prism(8, 1.0, drum0, drum1, cx=tx, phase=math.pi / 8), WOOD_DARK, jitter=0.05, colour_fn=lit())
    m.add(*pyramid(tx, 0, 1.35, drum1 - 0.1, drum1 + 0.6, n=8, phase=math.pi / 8), SHINGLE_DARK, jitter=0.05, colour_fn=lit())
    m.add(*prism(8, 0.5, drum1 + 0.4, drum1 + 1.0, cx=tx, phase=math.pi / 8), WOOD_DARK, jitter=0.05)
    onion(m, tx, 0, drum1 + 0.95, 0.85, 2.3, 8, DOME)
    # Porch tower: square base on the porch ridge, small drum, small dome.
    px = nave_x1 + 1.0
    base0 = porch_top + 0.9
    m.add(*box(px - 0.55, px + 0.55, -0.55, 0.55, base0, base0 + 1.3), WOOD_DARK, jitter=0.05)
    m.add(*pyramid(px, 0, 0.95, base0 + 1.2, base0 + 1.7), SHINGLE_DARK, jitter=0.05, colour_fn=lit())
    m.add(*prism(8, 0.32, base0 + 1.55, base0 + 2.0, cx=px, phase=math.pi / 8), WOOD_DARK, jitter=0.05)
    onion(m, px, 0, base0 + 1.95, 0.55, 1.5, 8, DOME)
    # Steps up to the door.
    m.add(*box(hx + 0.08, hx + 1.0, -0.9, 0.9, -SINK, plinth * 0.5), STONE_DARK, jitter=0.05, colour_fn=lit())
    return m


# ---------------------------------------------------------------- mountain huts

def mountain_hut_a():
    """Small hut, about 10 x 7.5 m: stone ground floor, board upper floor, steep gable roof
    with a deep overhang, a balcony along the front (-Y = three.js +Z, toward the road),
    green shutters, a chimney."""
    m = C.Model('mountain_hut_a', 41)
    hx, hy = 5.0, 3.7
    g1 = 2.9
    g2 = 5.6
    m.add(*box(-hx, hx, -hy, hy, -SINK, g1), STONE, jitter=0.06, colour_fn=lit())
    m.add(*box(-hx - 0.1, hx + 0.1, -hy - 0.1, hy + 0.1, g1, g2), WOOD, jitter=0.06)
    ridge = g2 + 3.6
    m.add(*gable(-hx - 0.9, hx + 0.9, -hy - 1.2, hy + 1.2, g2 - 0.35, ridge), SHINGLE, jitter=0.05, colour_fn=lit())
    m.add(*gable_wall(-hx - 0.1, -hy - 0.1, hy + 0.1, g2, ridge - 0.4, -1), WOOD, jitter=0.04)
    m.add(*gable_wall(hx + 0.1, -hy - 0.1, hy + 0.1, g2, ridge - 0.4, 1), WOOD, jitter=0.04)
    # Balcony on the front: floor slab, rail, two posts.
    m.add(*box(-hx + 0.4, hx - 0.4, -hy - 1.25, -hy - 0.1, g1 + 0.05, g1 + 0.25, bottom=True), WOOD_LIGHT, jitter=0.04, colour_fn=lit())
    m.add(*box(-hx + 0.4, hx - 0.4, -hy - 1.25, -hy - 1.1, g1 + 0.25, g1 + 1.2), WOOD_LIGHT, jitter=0.04, check=False)
    for x in (-hx + 0.5, hx - 0.6):
        m.add(*box(x, x + 0.15, -hy - 1.25, -hy - 1.1, -SINK, g1), WOOD_LIGHT, check=False)
    # Windows: ground floor small, upper floor with shutters, one in each gable.
    windows_on_wall(m, 'y', -hy, (-3.0, 0.0, 3.0), 1.0, 2.0, 0.4, -0.08)
    windows_on_wall(m, 'y', -hy - 0.1, (-2.6, 2.6), 3.6, 4.7, 0.45, -0.08, shutters=True)
    windows_on_wall(m, 'y', hy, (-2.5, 2.5), 1.0, 2.0, 0.4, 0.08)
    windows_on_wall(m, 'y', hy + 0.1, (-2.6, 2.6), 3.6, 4.7, 0.45, 0.08)
    windows_on_wall(m, 'x', hx + 0.1, (0.0,), g2 + 0.6, g2 + 1.6, 0.45, 0.08)
    windows_on_wall(m, 'x', -hx - 0.1, (0.0,), g2 + 0.6, g2 + 1.6, 0.45, -0.08)
    # Door at the +X end.
    m.add(*box(hx, hx + 0.08, -0.6, 0.6, 0.0, 2.2), WOOD_DARK, check=False)
    # Chimney through the back slope.
    m.add(*box(2.0, 2.7, 1.2, 1.9, g2, ridge + 0.6), STONE_DARK, jitter=0.05, colour_fn=lit())
    return m


def mountain_hut_b():
    """Bigger dom/refuge, about 14 x 10 m: two stone storeys with small windows, a board
    top floor, a steep hipped-gable roof, a front terrace wall and a lean-to on the side.
    For the large huts (Tičarjev dom, Erjavčeva koča, Refuge du Galibier)."""
    m = C.Model('mountain_hut_b', 1620)
    hx, hy = 7.0, 5.0
    g1 = 3.0
    g2 = 5.8
    g3 = 8.4
    m.add(*box(-hx, hx, -hy, hy, -SINK, g2), STONE, jitter=0.06, colour_fn=lit())
    m.add(*box(-hx - 0.1, hx + 0.1, -hy - 0.1, hy + 0.1, g2, g3), WOOD, jitter=0.06)
    # A band between the stone storeys.
    m.add(*box(-hx - 0.06, hx + 0.06, -hy - 0.06, hy + 0.06, g1, g1 + 0.2), STONE_DARK, check=False)
    ridge = g3 + 4.2
    m.add(*hip(-hx - 1.0, hx + 1.0, -hy - 1.1, hy + 1.1, g3 - 0.4, ridge, 1.6), SHINGLE, jitter=0.05, colour_fn=lit())
    # Windows: two rows in stone, shuttered row in the boards, on both long sides.
    xs = (-5.0, -2.5, 0.0, 2.5, 5.0)
    windows_on_wall(m, 'y', -hy, xs, 1.0, 2.1, 0.4, -0.08)
    windows_on_wall(m, 'y', -hy, xs, 3.7, 4.8, 0.4, -0.08)
    windows_on_wall(m, 'y', -hy - 0.1, (-4.2, -1.4, 1.4, 4.2), 6.6, 7.7, 0.45, -0.08, shutters=True)
    windows_on_wall(m, 'y', hy, (-4.0, 0.0, 4.0), 1.0, 2.1, 0.4, 0.08)
    windows_on_wall(m, 'y', hy + 0.1, (-4.0, 0.0, 4.0), 6.6, 7.7, 0.45, 0.08)
    windows_on_wall(m, 'x', hx, (-2.5, 2.5), 3.7, 4.8, 0.4, 0.08)
    windows_on_wall(m, 'x', -hx, (-2.5, 2.5), 3.7, 4.8, 0.4, -0.08)
    # Front door with a little gabled canopy.
    m.add(*box(-0.7, 0.7, -hy - 0.08, -hy, 0.0, 2.4), WOOD_DARK, check=False)
    m.add(*gable_y(-1.1, 1.1, -hy - 1.2, -hy + 0.05, 2.6, 3.4), SHINGLE_DARK, jitter=0.04, colour_fn=lit())
    # Terrace: a low stone wall and a wooden deck in front.
    m.add(*box(-hx, hx, -hy - 3.4, -hy - 0.05, -SINK, 0.25), STONE_DARK, jitter=0.05, colour_fn=lit())
    m.add(*box(-hx, hx, -hy - 3.6, -hy - 3.3, 0.25, 0.95), STONE, jitter=0.06, colour_fn=lit())
    # Lean-to store on the -X end, low shed roof.
    m.add(*box(-hx - 3.0, -hx, -hy + 1.0, hy - 1.0, -SINK, 2.6), WOOD, jitter=0.06)
    shed = [(-hx - 3.4, -hy + 0.6, 2.4), (-hx, -hy + 0.6, 3.4), (-hx, hy - 0.6, 3.4), (-hx - 3.4, hy - 0.6, 2.4)]
    m.add(shed, [(0, 1, 2, 3), (3, 2, 1, 0)], SHINGLE_DARK, jitter=0.04, colour_fn=lit(), check=False)
    # Two chimneys.
    for x in (-3.5, 3.5):
        m.add(*box(x - 0.4, x + 0.4, 1.0, 1.8, g3, ridge - 0.6), STONE_DARK, jitter=0.05, colour_fn=lit())
    return m


# ---------------------------------------------------------------- wayside

def wayside_shrine():
    """Slovenian / Alpine wayside shrine (kapelica): a whitewashed pillar with a painted
    niche facing -Y (three.js +Z, the road) and a small shingle gable roof. 1.3 m square,
    about 3.6 m tall."""
    m = C.Model('wayside_shrine', 7)
    h = 0.65
    m.add(*box(-h - 0.1, h + 0.1, -h - 0.1, h + 0.1, -0.4, 0.3), STONE, jitter=0.05, colour_fn=lit())
    m.add(*box(-h, h, -h, h, 0.3, 2.6), PLASTER, jitter=0.03, colour_fn=lit())
    # Niche: a dark blue recess panel with a lighter frame.
    m.add(*box(-0.42, 0.42, -h - 0.05, -h, 1.3, 2.3), PLASTER, check=False)
    m.add(*box(-0.32, 0.32, -h - 0.07, -h - 0.05, 1.4, 2.2), NICHE, check=False)
    # Ridge front-to-back, so the gable faces the road like real kapelice.
    m.add(*gable_y(-h - 0.3, h + 0.3, -h - 0.35, h + 0.35, 2.55, 3.35), SHINGLE_DARK, jitter=0.04, colour_fn=lit())
    m.add(*box(-0.04, 0.04, -0.04, 0.04, 3.3, 3.75), CROSS, check=False)
    m.add(*box(-0.2, 0.2, -0.04, 0.04, 3.55, 3.62), CROSS, check=False)
    return m


def wayside_cross():
    """Wooden wayside cross with a little roof over the crossing, on a stone foot.
    About 3.9 m tall; the arms run along X, the roof faces -Y (three.js +Z)."""
    m = C.Model('wayside_cross', 11)
    m.add(*box(-0.45, 0.45, -0.45, 0.45, -0.4, 0.35), STONE, jitter=0.05, colour_fn=lit())
    m.add(*box(-0.11, 0.11, -0.11, 0.11, 0.35, 3.45), WOOD_DARK, jitter=0.04)
    m.add(*box(-0.85, 0.85, -0.1, 0.1, 2.45, 2.65), WOOD_DARK, jitter=0.04)
    # Little gable roof over the top of the post, ridge front-to-back so the road sees
    # its triangle, like Alpine crucifixes.
    m.add(*gable_y(-0.55, 0.55, -0.5, 0.35, 3.05, 3.75), SHINGLE_DARK, jitter=0.04, colour_fn=lit())
    # A pale corpus: two light blocks on the front.
    m.add(*box(-0.07, 0.07, -0.18, -0.11, 1.75, 2.6), C.hex_rgb(0xcfc6b4), check=False)
    m.add(*box(-0.6, 0.6, -0.17, -0.11, 2.48, 2.6), C.hex_rgb(0xcfc6b4), check=False)
    return m


BUILDERS = {
    'ruska_kapelica': ruska_kapelica,
    'mountain_hut_a': mountain_hut_a,
    'mountain_hut_b': mountain_hut_b,
    'wayside_shrine': wayside_shrine,
    'wayside_cross': wayside_cross,
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
        C.render_sheet(models, os.path.join(preview, 'landmarks.png'), width=1800, height=700, elevation=16)
        # The same models turned 140 degrees: the back and one end, seen from above the eaves.
        turned = []
        c, sn = math.cos(math.radians(140)), math.sin(math.radians(140))
        for mo in models:
            t = C.Model(mo.name, 0)
            t.verts = [type(v)((v.x * c - v.y * sn, v.x * sn + v.y * c, v.z)) for v in mo.verts]
            t.faces = mo.faces
            turned.append(t)
        C.render_sheet(turned, os.path.join(preview, 'landmarks_turned.png'), width=1800, height=700, elevation=28)


if __name__ == '__main__':
    main()
