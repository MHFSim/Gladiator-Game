import { DynamicTexture, Scene, Texture } from '@babylonjs/core';

/* ---------- Rauschen (kachelbar) ---------- */

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Kachelbares Value-Noise: Periode p in Gitterzellen */
function vnoise(x: number, y: number, p: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const x0 = ((xi % p) + p) % p;
  const y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p;
  const y1 = (y0 + 1) % p;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fraktales Rauschen 0..1, u/v in 0..1, kachelbar */
export function fbm(u: number, v: number, freq: number, oct: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = freq;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(u * f, v * f, f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/* ---------- Hilfen ---------- */

type RGB = [number, number, number];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function makeTex(scene: Scene, name: string, w: number, h: number, linear = false): {
  tex: DynamicTexture;
  ctx: CanvasRenderingContext2D;
} {
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  if (linear) tex.gammaSpace = false;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  return { tex, ctx };
}

/** Normal-Map aus Höhenfeld (kachelbar) */
function normalFromHeight(scene: Scene, name: string, hgt: Float32Array, w: number, h: number, strength: number): DynamicTexture {
  const { tex, ctx } = makeTex(scene, name, w, h, true);
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => hgt[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  return tex;
}

export interface PbrMaps {
  albedo: DynamicTexture;
  normal: DynamicTexture;
}

function fillAlbedo(scene: Scene, name: string, w: number, h: number, fn: (x: number, y: number) => RGB): DynamicTexture {
  const { tex, ctx } = makeTex(scene, name, w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      img.data[i] = clamp255(r);
      img.data[i + 1] = clamp255(g);
      img.data[i + 2] = clamp255(b);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  return tex;
}

/* ---------- Sand ---------- */

export function sandMaps(scene: Scene, size = 512): PbrMaps {
  const w = size;
  const h = size;
  const hgt = new Float32Array(w * h);
  const col = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const grain = fbm(u, v, 64, 3, 11);
      const ripple = fbm(u, v, 6, 4, 23);
      const patch = fbm(u, v, 3, 3, 41);
      let pebble = fbm(u, v, 40, 2, 77);
      pebble = pebble > 0.72 ? (pebble - 0.72) * 3.5 : 0;
      const ht = grain * 0.35 + ripple * 0.45 + pebble * 0.6;
      hgt[y * w + x] = ht;
      const shade = 0.82 + grain * 0.22 + (patch - 0.5) * 0.18 + pebble * 0.25;
      const i = (y * w + x) * 3;
      col[i] = 198 * shade;
      col[i + 1] = 166 * shade;
      col[i + 2] = 122 * shade * (0.96 + pebble * 0.2);
    }
  }
  const albedo = fillAlbedo(scene, 'sand_albedo', w, h, (x, y) => {
    const i = (y * w + x) * 3;
    return [col[i], col[i + 1], col[i + 2]];
  });
  const normal = normalFromHeight(scene, 'sand_normal', hgt, w, h, 6);
  return { albedo, normal };
}

/* ---------- Quadersteine (Tuff / Travertin) ---------- */

export function stoneMaps(scene: Scene, size = 512, rows = 4, tint: RGB = [214, 196, 162]): PbrMaps {
  const w = size;
  const h = size;
  const hgt = new Float32Array(w * h);
  const rowH = h / rows;
  const mortar = 3;
  const albedo = fillAlbedo(scene, 'stone_albedo', w, h, (x, y) => {
    const r = Math.floor(y / rowH);
    const blockW = w / 2;
    const off = (r % 2) * blockW * 0.5;
    const bx = Math.floor(((x + off) % w) / blockW);
    const lx = ((x + off) % w) - bx * blockW;
    const ly = y - r * rowH;
    const u = x / w;
    const v = y / h;
    const edgeNoise = fbm(u, v, 24, 2, 5) * 3;
    const dEdge = Math.min(lx, blockW - lx, ly, rowH - ly) - edgeNoise;
    const blockVar = hash(bx + r * 7, r, 3) - 0.5;
    const n = fbm(u, v, 16, 4, 9);
    const pores = fbm(u, v, 48, 2, 13);
    const pore = pores < 0.3 ? (0.3 - pores) * 2.2 : 0;
    let ht = 0.6 + n * 0.3 - pore * 0.5;
    let shade = 0.82 + n * 0.3 + blockVar * 0.16 - pore * 0.4;
    if (dEdge < mortar) {
      ht = 0.1 + n * 0.1;
      shade = 0.55 + n * 0.15;
    } else if (dEdge < mortar + 4) {
      ht *= 0.8 + (dEdge - mortar) * 0.05;
    }
    // Schmutzschlieren von oben nach unten
    const grime = fbm(u * 3, v * 0.4, 4, 3, 91);
    shade *= 0.9 + grime * 0.18;
    hgt[y * w + x] = ht;
    return [tint[0] * shade, tint[1] * shade, tint[2] * shade];
  });
  const normal = normalFromHeight(scene, 'stone_normal', hgt, w, h, 5);
  return { albedo, normal };
}

/* ---------- Bemalter Putz der Arenamauer ---------- */

export function plasterMaps(scene: Scene): PbrMaps {
  // Eine Kachel = 8 m breit, 3,2 m hoch
  const w = 1024;
  const h = 410;
  const { tex: albedo, ctx } = makeTex(scene, 'plaster_albedo', w, h);
  const cream = '#d9c8a4';
  ctx.fillStyle = cream;
  ctx.fillRect(0, 0, w, h);
  // Sockel dunkelrot
  ctx.fillStyle = '#5e1a14';
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  // Paneele
  const panels = 2;
  for (let i = 0; i < panels; i++) {
    const x0 = (i * w) / panels + 26;
    const pw = w / panels - 52;
    ctx.fillStyle = i % 2 === 0 ? '#8e2a1d' : '#b9823a';
    ctx.fillRect(x0, h * 0.12, pw, h * 0.6);
    ctx.strokeStyle = '#1c0f0a';
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 10, h * 0.12 + 10, pw - 20, h * 0.6 - 20);
    ctx.strokeStyle = '#e6d6b0';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 18, h * 0.12 + 18, pw - 36, h * 0.6 - 36);
    // Kranz in der Mitte
    const cx = x0 + pw / 2;
    const cy = h * 0.42;
    ctx.strokeStyle = i % 2 === 0 ? '#d8b25e' : '#4a2a14';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, Math.PI * 0.65, Math.PI * 2.35);
    ctx.stroke();
    for (let k = 0; k < 12; k++) {
      const a = Math.PI * 0.75 + (k / 11) * Math.PI * 1.5;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34, 9, 4, a + 0.8, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  }
  // Gesims oben
  ctx.fillStyle = '#efe2c4';
  ctx.fillRect(0, 0, w, h * 0.06);
  ctx.fillStyle = '#2a170e';
  ctx.fillRect(0, h * 0.06, w, 3);
  ctx.fillRect(0, h * 0.78, w, 3);
  // Alterung: Rauschen, Abplatzer, Schlieren
  const img = ctx.getImageData(0, 0, w, h);
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const n = fbm(u, v, 16, 4, 201);
      const streak = fbm(u * 4, v * 0.3, 8, 3, 202);
      const chip = fbm(u, v, 20, 3, 203);
      const i = (y * w + x) * 4;
      let s = 0.82 + n * 0.25 - Math.max(0, streak - 0.55) * 0.6;
      let ht = 0.6 + n * 0.1;
      if (chip > 0.7) {
        // abgeplatzter Putz zeigt Ziegel
        const k = Math.min(1, (chip - 0.7) * 8);
        img.data[i] = img.data[i] * (1 - k) + 150 * k;
        img.data[i + 1] = img.data[i + 1] * (1 - k) + 92 * k;
        img.data[i + 2] = img.data[i + 2] * (1 - k) + 66 * k;
        ht -= k * 0.4;
      }
      if (v > 0.9) s *= 0.85 + fbm(u, v, 30, 2, 204) * 0.2; // Spritzer vom Sand
      img.data[i] = clamp255(img.data[i] * s);
      img.data[i + 1] = clamp255(img.data[i + 1] * s);
      img.data[i + 2] = clamp255(img.data[i + 2] * s);
      hgt[y * w + x] = ht;
    }
  }
  ctx.putImageData(img, 0, 0);
  albedo.update(false);
  const normal = normalFromHeight(scene, 'plaster_normal', hgt, w, h, 4);
  return { albedo, normal };
}

/* ---------- Holz ---------- */

export function woodMaps(scene: Scene, size = 256): PbrMaps {
  const w = size;
  const h = size;
  const hgt = new Float32Array(w * h);
  const planks = 4;
  const albedo = fillAlbedo(scene, 'wood_albedo', w, h, (x, y) => {
    const u = x / w;
    const v = y / h;
    const p = Math.floor(u * planks);
    const lu = u * planks - p;
    const grain = fbm(u * 2 + p * 0.3, v * 0.08, 32, 4, 300 + p);
    const ring = Math.sin((grain * 18 + lu * 3) * Math.PI) * 0.5 + 0.5;
    const pv = hash(p, 1, 31) - 0.5;
    let s = 0.7 + ring * 0.2 + pv * 0.2;
    let ht = 0.5 + ring * 0.2;
    if (lu < 0.025 || lu > 0.975) {
      s *= 0.45;
      ht = 0.05;
    }
    hgt[y * w + x] = ht;
    return [128 * s, 86 * s, 52 * s];
  });
  const normal = normalFromHeight(scene, 'wood_normal', hgt, w, h, 4);
  return { albedo, normal };
}

/* ---------- Dachziegel ---------- */

export function tileMaps(scene: Scene, size = 256): PbrMaps {
  const w = size;
  const h = size;
  const hgt = new Float32Array(w * h);
  const cols = 8;
  const rows = 6;
  const albedo = fillAlbedo(scene, 'tile_albedo', w, h, (x, y) => {
    const u = x / w;
    const v = y / h;
    const cu = u * cols;
    const r = Math.floor(v * rows);
    const lv = v * rows - r;
    const arch = Math.sin((cu - Math.floor(cu)) * Math.PI);
    const n = fbm(u, v, 16, 3, 400);
    const t = hash(Math.floor(cu), r, 41) - 0.5;
    const ht = arch * 0.8 - lv * 0.2;
    hgt[y * w + x] = ht;
    const s = 0.55 + arch * 0.45 + n * 0.15 + t * 0.15 - (lv > 0.9 ? 0.25 : 0);
    return [172 * s, 84 * s, 52 * s];
  });
  const normal = normalFromHeight(scene, 'tile_normal', hgt, w, h, 6);
  return { albedo, normal };
}

/* ---------- Bronze / Metall / Leder / Stoff (nur Albedo + leichte Struktur) ---------- */

export function noiseAlbedo(scene: Scene, name: string, base: RGB, variance: number, freq: number, size = 256): DynamicTexture {
  return fillAlbedo(scene, name, size, size, (x, y) => {
    const n = fbm(x / size, y / size, freq, 4, name.length * 13);
    const s = 1 - variance / 2 + n * variance;
    return [base[0] * s, base[1] * s, base[2] * s];
  });
}

export function clothMaps(scene: Scene, base: RGB, size = 256): PbrMaps {
  const w = size;
  const h = size;
  const hgt = new Float32Array(w * h);
  const albedo = fillAlbedo(scene, 'cloth_albedo_' + base.join('_'), w, h, (x, y) => {
    const u = x / w;
    const v = y / h;
    const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5 + 0.5;
    const n = fbm(u, v, 8, 3, 501);
    hgt[y * w + x] = weave * 0.4 + n * 0.3;
    const s = 0.82 + weave * 0.08 + n * 0.18;
    return [base[0] * s, base[1] * s, base[2] * s];
  });
  const normal = normalFromHeight(scene, 'cloth_normal_' + base.join('_'), hgt, w, h, 2);
  return { albedo, normal };
}

/* ---------- Schildbemalung (Scutum) ---------- */

export function shieldTexture(scene: Scene, field: string, emblem: string): DynamicTexture {
  const w = 512;
  const h = 768;
  const { tex, ctx } = makeTex(scene, 'shield_' + field, w, h);
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, w, h);
  // Rahmen
  ctx.strokeStyle = emblem;
  ctx.lineWidth = 18;
  ctx.strokeRect(30, 30, w - 60, h - 60);
  ctx.lineWidth = 5;
  ctx.strokeRect(58, 58, w - 116, h - 116);
  // Blitzbündel und Flügel
  ctx.fillStyle = emblem;
  ctx.strokeStyle = emblem;
  const cx = w / 2;
  const cy = h / 2;
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const y0 = cy - 30 + i * 22;
      ctx.moveTo(cx + dir * 70, y0);
      ctx.quadraticCurveTo(cx + dir * 150, y0 - 60 + i * 10, cx + dir * 200, y0 - 110 + i * 34);
      ctx.lineTo(cx + dir * 190, y0 - 90 + i * 34);
      ctx.quadraticCurveTo(cx + dir * 140, y0 - 30 + i * 10, cx + dir * 70, y0 + 14);
      ctx.fill();
    }
    // Blitze nach oben und unten
    for (const vy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + dir * 12, cy + vy * 70);
      ctx.lineTo(cx + dir * 34, cy + vy * 150);
      ctx.lineTo(cx + dir * 8, cy + vy * 150);
      ctx.lineTo(cx + dir * 40, cy + vy * 270);
      ctx.lineTo(cx - dir * 6, cy + vy * 140);
      ctx.lineTo(cx + dir * 16, cy + vy * 140);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Abnutzung
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / w, y / h, 12, 4, 601);
      const scratch = fbm(x / w * 6, y / h * 0.5, 16, 2, 602);
      const i = (y * w + x) * 4;
      let s = 0.8 + n * 0.3;
      if (scratch > 0.78) s *= 0.7;
      img.data[i] = clamp255(img.data[i] * s);
      img.data[i + 1] = clamp255(img.data[i + 1] * s);
      img.data[i + 2] = clamp255(img.data[i + 2] * s);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/* ---------- Gitter für das Helmvisier ---------- */

export function grilleTexture(scene: Scene): DynamicTexture {
  const s = 256;
  const { tex, ctx } = makeTex(scene, 'grille', s, s);
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#b07a3a';
  ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'destination-out';
  const n = 9;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.beginPath();
      ctx.arc((x + 0.5 + (y % 2) * 0.5) * (s / n), (y + 0.5) * (s / n), s / n / 2.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  tex.hasAlpha = true;
  tex.update(false);
  return tex;
}

/* ---------- Partikel ---------- */

export function flareTexture(scene: Scene, name: string, inner: string, outer: string): DynamicTexture {
  const s = 64;
  const { tex, ctx } = makeTex(scene, name, s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.update(false);
  return tex;
}
