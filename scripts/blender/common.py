"""Shared helpers for the low-poly prop scripts (trees.py, rocks.py).

Geometry is built as plain Python lists (vertices + faces with one colour per face),
then turned into a Blender mesh only to export the GLB and render the preview sheet.
That keeps every model deterministic (seeded `random.Random`) and makes the face
colours exact: one colour per face, written to every corner of that face, so the
game sees flat per-face vertex colours like the code-built props in models.ts.

Coordinates while building are Blender's: metres, Z up, origin at the ground centre.
The glTF exporter turns that into +Y up. "Front" of a cliff is Blender -Y, which is
glTF/three.js +Z.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(REPO, 'src', 'assets', 'models')


# ---------------------------------------------------------------- colour

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    """sRGB hex (as written in models.ts) to linear floats. glTF COLOR_0 is linear,
    and three.js' Color(hex) also stores linear, so the two match."""
    return tuple(srgb_to_linear(((h >> s) & 255) / 255) for s in (16, 8, 0))


def shade(rgb, k):
    return tuple(max(0.0, min(1.0, c * k)) for c in rgb)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# ---------------------------------------------------------------- mesh

class Model:
    """Vertices and faces with one linear RGB colour per face."""

    def __init__(self, name, seed):
        self.name = name
        self.rng = random.Random(seed)
        self.verts = []
        self.faces = []  # (tuple of vertex indices, rgb)

    def add(self, verts, faces, colour, jitter=0.0, colour_fn=None, check=True):
        """Append a part. `colour_fn(face_verts, rgb) -> rgb` can tint by position or
        normal (rocks: lighter tops). `jitter` is the per-face brightness spread.
        `check=False` skips the outward-winding check for parts that are not convex
        around their centre (drooping conifer tiers)."""
        base = len(self.verts)
        self.verts.extend(Vector(v) for v in verts)
        centre = sum((Vector(v) for v in verts), Vector()) / max(1, len(verts))
        for f in faces:
            pts = [self.verts[base + i] for i in f]
            c = sum(pts, Vector()) / len(pts)
            if check and face_normal(pts).dot(c - centre) < -1e-6:
                # Every part is roughly convex around its centre; an inward face means a
                # winding bug and would vanish in game (three.js culls back faces).
                print(f'WARNING {self.name}: inward face {f}')
            rgb = colour
            if colour_fn:
                rgb = colour_fn([self.verts[base + i] for i in f], rgb)
            if jitter:
                rgb = shade(rgb, 1 + (self.rng.random() * 2 - 1) * jitter)
            self.faces.append((tuple(base + i for i in f), rgb))

    def tris(self):
        return sum(len(f) - 2 for f, _ in self.faces)

    def bounds(self):
        xs = [v.x for v in self.verts]
        ys = [v.y for v in self.verts]
        zs = [v.z for v in self.verts]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def face_normal(pts):
    n = Vector((0, 0, 0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))


# ---------------------------------------------------------------- transforms

def xform(verts, scale=(1, 1, 1), rot_z=0.0, tilt=(0.0, 0.0), offset=(0, 0, 0)):
    """Scale, tilt (rotation about X then Y, radians), spin about Z, then move."""
    cz, sz = math.cos(rot_z), math.sin(rot_z)
    cx, sx = math.cos(tilt[0]), math.sin(tilt[0])
    cy, sy = math.cos(tilt[1]), math.sin(tilt[1])
    out = []
    for x, y, z in verts:
        x, y, z = x * scale[0], y * scale[1], z * scale[2]
        y, z = y * cx - z * sx, y * sx + z * cx
        x, z = x * cy + z * sy, -x * sy + z * cy
        x, y = x * cz - y * sz, x * sz + y * cz
        out.append((x + offset[0], y + offset[1], z + offset[2]))
    return out


# ---------------------------------------------------------------- primitives

def frustum(n, r0, r1, z0, z1, rng=None, wobble=0.0, cap_bottom=False, cap_top=True, phase=0.0):
    """Open-bottom n-sided frustum (trunks, stems). Top capped unless r1 == 0."""
    verts, faces = [], []
    for z, r in ((z0, r0), (z1, r1)):
        for i in range(n):
            a = phase + i / n * math.tau
            rr = r * (1 + ((rng.random() * 2 - 1) * wobble if rng else 0))
            verts.append((math.cos(a) * rr, math.sin(a) * rr, z))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    if cap_top and r1 > 0:
        faces.append(tuple(range(2 * n - 1, n - 1, -1))[::-1])
    if cap_bottom:
        faces.append(tuple(range(n - 1, -1, -1)))
    return verts, faces


def star_cone(n, r_out, r_in, z_base, z_top, droop, rng, wobble=0.12, under_rise=0.35, phase=0.0):
    """Conifer tier: a cone whose base is a star (branch tips out and down, notches in
    and up) so the silhouette is jagged, with a shallow underside rising to the trunk.
    2n side triangles + 2n underside triangles."""
    verts = [(0, 0, z_top)]
    for i in range(2 * n):
        a = phase + i / (2 * n) * math.tau
        tip = i % 2 == 0
        r = (r_out if tip else r_in) * (1 + (rng.random() * 2 - 1) * wobble)
        z = z_base - (droop if tip else 0) + (rng.random() - 0.5) * 0.15 * r_out
        verts.append((math.cos(a) * r, math.sin(a) * r, z))
    verts.append((0, 0, z_base + under_rise * (z_top - z_base)))
    c = len(verts) - 1
    faces = []
    for i in range(2 * n):
        a, b = 1 + i, 1 + (i + 1) % (2 * n)
        faces.append((0, a, b))
        faces.append((c, b, a))
    return verts, faces


ICO_V = None
ICO_F = None


def _ico():
    global ICO_V, ICO_F
    if ICO_V is None:
        t = (1 + 5 ** 0.5) / 2
        v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
             (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
        ICO_V = [tuple(c / math.sqrt(1 + t * t) for c in p) for p in v]
        ICO_F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2),
                 (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5),
                 (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    return ICO_V, ICO_F


def blob(rng, radius=1.0, scale=(1, 1, 1), wobble=0.18, flat_bottom=None):
    """20-triangle icosahedron with each vertex pushed in or out: a foliage clump.
    `flat_bottom` (fraction of radius) squashes the lower vertices up into a flatter
    underside, like a crown seen from below."""
    v, f = _ico()
    out = []
    for x, y, z in v:
        k = radius * (1 + (rng.random() * 2 - 1) * wobble)
        z2 = z
        if flat_bottom is not None and z < -flat_bottom:
            z2 = -flat_bottom + (z + flat_bottom) * 0.35
        out.append((x * k * scale[0], y * k * scale[1], z2 * k * scale[2]))
    return out, list(f)


def lathe(profile, n, rng, wobble=0.0, phase=0.0):
    """Surface of revolution from (radius, z) pairs, bottom to top. A zero radius at
    either end becomes a single point (cone tip / closed base)."""
    verts, rings = [], []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([len(verts)])
            verts.append((0, 0, z))
            continue
        ring = []
        for i in range(n):
            a = phase + i / n * math.tau
            rr = r * (1 + (rng.random() * 2 - 1) * wobble)
            ring.append(len(verts))
            verts.append((math.cos(a) * rr, math.sin(a) * rr, z))
        rings.append(ring)
    faces = []
    for lo, hi in zip(rings, rings[1:]):
        if len(lo) == 1 and len(hi) == 1:
            continue
        if len(lo) == 1:
            for i in range(n):
                faces.append((lo[0], hi[(i + 1) % n], hi[i]))
        elif len(hi) == 1:
            for i in range(n):
                faces.append((lo[i], lo[(i + 1) % n], hi[0]))
        else:
            for i in range(n):
                j = (i + 1) % n
                faces.append((lo[i], lo[j], hi[j], hi[i]))
    return verts, faces


def hull(points):
    """Convex hull of a point cloud as (verts, faces), triangles merged into flat
    n-gons where coplanar. Angular rocks come from hulls of a few points."""
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:], use_existing_faces=False)
    # convex_hull can leave unused interior verts; drop them.
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts[:], edges=bm.edges[:])
    bm.verts.index_update()
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    return verts, faces


# ---------------------------------------------------------------- export + preview

def to_object(model):
    mesh = bpy.data.meshes.new(model.name)
    mesh.from_pydata([tuple(v) for v in model.verts], [], [f for f, _ in model.faces])
    mesh.validate(clean_customdata=False)
    attr = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly, (_, rgb) in zip(mesh.polygons, model.faces):
        poly.use_smooth = False
        for li in poly.loop_indices:
            attr.data[li].color = (*rgb, 1.0)
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = 0
    obj = bpy.data.objects.new(model.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_glb(obj, path):
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_materials='NONE',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_attributes=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )


def export_models(models):
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for m in models:
        reset_scene()
        obj = to_object(m)
        path = os.path.join(OUT_DIR, m.name + '.glb')
        export_glb(obj, path)
        lo, hi = m.bounds()
        rows.append((m.name, m.tris(), os.path.getsize(path), lo, hi))
    for name, tris, size, lo, hi in rows:
        print(f'{name:18s} {tris:4d} tris {size / 1024:5.1f} KB  '
              f'w {hi[0] - lo[0]:5.1f} d {hi[1] - lo[1]:5.1f} h {hi[2] - lo[2]:5.1f}  zmin {lo[2]:+.2f}')
    return rows


def render_sheet(models, path, width=1800, height=700, elevation=8.0, gap=1.5, label=True):
    """All models in a row, orthographic, Workbench with vertex colours on white."""
    reset_scene()
    scene = bpy.context.scene
    x = 0.0
    tallest = 0.0
    objs = []
    for m in models:
        lo, hi = m.bounds()
        obj = to_object(m)
        obj.location.x = x - lo[0]
        x += (hi[0] - lo[0]) + gap
        tallest = max(tallest, hi[2])
        objs.append(obj)
        if label:
            bpy.ops.object.text_add(location=(obj.location.x + (lo[0] + hi[0]) / 2, -6, -1.2))
            t = bpy.context.object
            t.data.body = m.name
            t.data.align_x = 'CENTER'
            t.data.size = max(0.5, tallest * 0.05)
            t.rotation_euler = (math.radians(90), 0, 0)
    total = x - gap
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
    except TypeError:
        scene.render.engine = 'BLENDER_WORKBENCH_NEXT'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'VERTEX'
    shading.show_object_outline = False
    shading.show_backface_culling = True
    shading.show_shadows = True
    shading.background_type = 'VIEWPORT'
    shading.background_color = (1, 1, 1)
    scene.world = bpy.data.worlds.new('w')
    scene.world.color = (1, 1, 1)
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = max(total + 2, (tallest + 4) * width / height)
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    dist = 200
    pitch = math.radians(elevation)
    cam.location = (total / 2, -dist * math.cos(pitch), tallest / 2 + dist * math.sin(pitch) - 0.5)
    cam.rotation_euler = (math.radians(90) - pitch, 0, 0)
    scene.camera = cam
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)


def args():
    argv = sys.argv
    return argv[argv.index('--') + 1:] if '--' in argv else []
