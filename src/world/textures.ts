import * as THREE from 'three';

/** Lines of text centred on a canvas, for signs and banners. */
export function textTexture(lines: { text: string; size: number; color: string; weight?: string }[], bg: string, w = 256, h = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const total = lines.reduce((a, l) => a + l.size * 1.15, 0);
  let y = (h - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const l of lines) {
    ctx.fillStyle = l.color;
    ctx.font = `${l.weight ?? '800'} ${l.size}px Poppins, sans-serif`;
    ctx.fillText(l.text, w / 2, y);
    y += l.size * 1.15;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
