import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, Texture, Vector3 } from '@babylonjs/core';
import { GeoBuilder } from '../render/geometry';
import { clothMaps, grilleTexture, noiseAlbedo, shieldTexture, woodMaps } from '../render/textures';
import type { Environment } from '../render/environment';

/**
 * Ausrüstung eines Murmillo, komplett im Code erzeugt.
 * Jedes Teil wird in einem eigenen lokalen Rahmen gebaut (Y = oben/Längsachse, Z = vorn)
 * und später an den passenden Knochen gehängt.
 */
export interface GearMaterials {
  bronze: PBRMaterial;
  iron: PBRMaterial;
  leather: PBRMaterial;
  wood: PBRMaterial;
  cloth: PBRMaterial;
  plume: PBRMaterial;
  grille: PBRMaterial;
  shieldFront: PBRMaterial;
}

export interface Team {
  field: string; // Schildfarbe
  emblem: string;
  plume: [number, number, number];
}

export function gearMaterials(scene: Scene, env: Environment, team: Team, id: string): GearMaterials {
  const metal = (name: string, color: Color3, rough: number) => {
    const m = new PBRMaterial(name + id, scene);
    m.albedoColor = color;
    m.albedoTexture = noiseAlbedo(scene, 'patina' + name, [255, 255, 255], 0.28, 6);
    m.metallic = 0.62;
    m.roughness = rough + 0.08;
    m.reflectionTexture = env.probe.cubeTexture;
    m.environmentIntensity = 0.32;
    m.maxSimultaneousLights = 6;
    return m;
  };
  const diel = (name: string, tex: Texture | null, color: Color3, rough: number) => {
    const m = new PBRMaterial(name + id, scene);
    if (tex) m.albedoTexture = tex;
    m.albedoColor = color;
    m.metallic = 0;
    m.roughness = rough;
    m.environmentIntensity = 0;
    m.maxSimultaneousLights = 6;
    return m;
  };
  const bronze = metal('bronze', new Color3(0.6, 0.36, 0.15), 0.3);
  const iron = metal('iron', new Color3(0.72, 0.72, 0.74), 0.24);
  const leather = diel('leather', clothMaps(scene, [96, 58, 34]).albedo, Color3.White(), 0.7);
  const wood = diel('woodGear', woodMaps(scene, 128).albedo, Color3.White(), 0.7);
  const cloth = diel('linen', clothMaps(scene, [222, 210, 186]).albedo, Color3.White(), 0.9);
  const plume = diel('plume', clothMaps(scene, team.plume).albedo, Color3.White(), 0.95);
  plume.backFaceCulling = false;
  const grille = metal('grille', new Color3(0.7, 0.46, 0.24), 0.4);
  grille.albedoTexture = grilleTexture(scene);
  grille.useAlphaFromAlbedoTexture = true;
  grille.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  grille.alphaCutOff = 0.5;
  grille.backFaceCulling = false;
  const shieldFront = diel('shieldFront', shieldTexture(scene, team.field, team.emblem), Color3.White(), 0.55);
  return { bronze, iron, leather, wood, cloth, plume, grille, shieldFront };
}

/* ---------- Hilfen ---------- */

/** Rotationskörper mit Winkelbereich. Winkel 0 = vorn (+Z). profile: [r, y] von oben nach unten */
function lathe(g: GeoBuilder, profile: [number, number][], a0: number, a1: number, seg: number, outward = true): void {
  const base = g.positions.length / 3;
  const cols = seg + 1;
  for (let j = 0; j < profile.length; j++) {
    const [r, y] = profile[j];
    // Profilnormale aus Nachbarn
    const [rp, yp] = profile[Math.max(0, j - 1)];
    const [rn, yn] = profile[Math.min(profile.length - 1, j + 1)];
    const dr = rn - rp;
    const dy = yn - yp;
    // senkrecht zur Profilrichtung, nach außen
    let nr = -dy;
    let ny = dr;
    const l = Math.hypot(nr, ny) || 1;
    nr /= l;
    ny /= l;
    if (nr < 0 && outward) {
      nr = -nr;
      ny = -ny;
    }
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const n = new Vector3(s * nr, ny, c * nr);
      if (!outward) n.scaleInPlace(-1);
      g.vertex(new Vector3(s * r, y, c * r), n, i / seg, j / (profile.length - 1));
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const k = base + j * cols + i;
      g.quad(k, k + 1, k + cols + 1, k + cols);
    }
  }
}

function finalize(mesh: Mesh, mat: PBRMaterial): Mesh {
  mesh.material = mat;
  mesh.receiveShadows = true;
  return mesh;
}

/* ---------- Gladius ---------- */

export function buildGladius(scene: Scene, m: GearMaterials): Mesh {
  // Griff in der Mitte (0), Klinge entlang +Y
  const gBlade = new GeoBuilder();
  const sections: [number, number][] = [
    [0.075, 0.056],
    [0.3, 0.05],
    [0.47, 0.047],
    [0.52, 0.036],
    [0.6, 0.0],
  ];
  const th = 0.009;
  for (let k = 0; k < sections.length - 1; k++) {
    const [y0, w0] = sections[k];
    const [y1, w1] = sections[k + 1];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p0 = new Vector3(0, y0, sz * th);
        const p1 = new Vector3(sx * w0 / 2, y0, 0);
        const p2 = new Vector3(sx * w1 / 2, y1, 0);
        const p3 = new Vector3(0, y1, sz * th * (w1 > 0 ? 1 : 0));
        const n = Vector3.Cross(p1.subtract(p0), p3.subtract(p0)).normalize();
        if (n.z * sz < 0) n.scaleInPlace(-1);
        const a = gBlade.vertex(p0, n, 0.5, y0);
        const b = gBlade.vertex(p1, n, 0.5 + sx * 0.5, y0);
        const c = gBlade.vertex(p2, n, 0.5 + sx * 0.5, y1);
        const d = gBlade.vertex(p3, n, 0.5, y1);
        gBlade.quad(a, b, c, d);
      }
    }
  }
  const blade = finalize(gBlade.build('blade', scene), m.iron);
  const grip = MeshBuilder.CreateCylinder('grip', { height: 0.1, diameter: 0.034, tessellation: 10 }, scene);
  grip.material = m.wood;
  const guard = MeshBuilder.CreateBox('guard', { width: 0.08, height: 0.028, depth: 0.05 }, scene);
  guard.position.y = 0.062;
  guard.material = m.bronze;
  const pommel = MeshBuilder.CreateSphere('pommel', { diameterX: 0.06, diameterY: 0.04, diameterZ: 0.05, segments: 10 }, scene);
  pommel.position.y = -0.066;
  pommel.material = m.bronze;
  const sword = Mesh.MergeMeshes([blade, grip, guard, pommel], true, true, undefined, false, true) as Mesh;
  sword.name = 'gladius';
  sword.receiveShadows = true;
  return sword;
}

/* ---------- Scutum ---------- */

export function buildScutum(scene: Scene, m: GearMaterials): Mesh {
  const W = 0.64;
  const H = 1.02;
  const k = 1.2; // Wölbung
  const t = 0.022;
  const seg = 14;
  const gF = new GeoBuilder();
  const gB = new GeoBuilder();
  const gE = new GeoBuilder();
  const zAt = (x: number) => -k * x * x;
  const front: number[][] = [];
  const back: number[][] = [];
  for (let i = 0; i <= seg; i++) {
    const x = -W / 2 + (W * i) / seg;
    const z = zAt(x);
    const n = new Vector3(2 * k * x, 0, 1).normalize();
    const rowF: number[] = [];
    const rowB: number[] = [];
    for (const [j, y] of [-H / 2, H / 2].entries()) {
      rowF.push(gF.vertex(new Vector3(x, y, z), n, i / seg, j));
      rowB.push(gB.vertex(new Vector3(x, y, z - t), n.scale(-1), (i / seg) * 2, j * 3));
    }
    front.push(rowF);
    back.push(rowB);
  }
  for (let i = 0; i < seg; i++) {
    gF.quad(front[i][0], front[i + 1][0], front[i + 1][1], front[i][1]);
    gB.quad(back[i][0], back[i + 1][0], back[i + 1][1], back[i][1]);
  }
  // Bronzerand
  for (let i = 0; i < seg; i++) {
    const x0 = -W / 2 + (W * i) / seg;
    const x1 = x0 + W / seg;
    for (const y of [-H / 2, H / 2]) {
      const n = new Vector3(0, Math.sign(y), 0);
      const a = gE.vertex(new Vector3(x0, y, zAt(x0) + 0.006), n, 0, 0);
      const b = gE.vertex(new Vector3(x1, y, zAt(x1) + 0.006), n, 1, 0);
      const c = gE.vertex(new Vector3(x1, y, zAt(x1) - t - 0.006), n, 1, 1);
      const d = gE.vertex(new Vector3(x0, y, zAt(x0) - t - 0.006), n, 0, 1);
      gE.quad(a, b, c, d);
    }
  }
  for (const x of [-W / 2, W / 2]) {
    const n = new Vector3(Math.sign(x), 0, 0);
    const z = zAt(x);
    const a = gE.vertex(new Vector3(x, -H / 2, z + 0.006), n, 0, 0);
    const b = gE.vertex(new Vector3(x, H / 2, z + 0.006), n, 1, 0);
    const c = gE.vertex(new Vector3(x, H / 2, z - t - 0.006), n, 1, 1);
    const d = gE.vertex(new Vector3(x, -H / 2, z - t - 0.006), n, 0, 1);
    gE.quad(a, b, c, d);
  }
  const f = finalize(gF.build('scutumFront', scene), m.shieldFront);
  const b = finalize(gB.build('scutumBack', scene), m.wood);
  const e = finalize(gE.build('scutumRim', scene), m.bronze);
  const boss = MeshBuilder.CreateSphere('boss', { diameter: 0.17, slice: 0.5, segments: 14 }, scene);
  boss.rotation.x = Math.PI / 2;
  boss.scaling.y = 0.55;
  boss.position.z = 0.0;
  boss.material = m.bronze;
  const grip = MeshBuilder.CreateBox('shieldGrip', { width: 0.12, height: 0.03, depth: 0.03 }, scene);
  grip.position.z = -t - 0.05;
  grip.material = m.leather;
  const shield = Mesh.MergeMeshes([f, b, e, boss, grip], true, true, undefined, false, true) as Mesh;
  shield.name = 'scutum';
  shield.receiveShadows = true;
  return shield;
}

/* ---------- Helm (Murmillo mit Kamm und Gittervisier) ---------- */

export function buildHelmet(scene: Scene, m: GearMaterials, s: number): Mesh {
  // s = Kopfradius-Skalierung
  const dome: [number, number][] = [
    [0.0, 0.165],
    [0.07, 0.155],
    [0.12, 0.125],
    [0.15, 0.075],
    [0.162, 0.02],
  ];
  const lower: [number, number][] = [
    [0.162, 0.02],
    [0.165, -0.05],
    [0.158, -0.115],
  ];
  const brim: [number, number][] = [
    [0.158, -0.115],
    [0.2, -0.12],
    [0.255, -0.14],
    [0.262, -0.15],
  ];
  const sc = (p: [number, number][]) => p.map(([r, y]) => [r * s, y * s] as [number, number]);
  const gH = new GeoBuilder();
  lathe(gH, sc(dome), 0, Math.PI * 2, 32);
  // Offenes Gesicht: Unterteil und Krempe vorn ausgespart (±72°), damit man das Gesicht sieht
  const open = (72 * Math.PI) / 180;
  lathe(gH, sc(lower), open, Math.PI * 2 - open, 26);
  lathe(gH, sc(brim), open * 0.85, Math.PI * 2 - open * 0.85, 28);
  // Stirnband über dem Gesicht
  lathe(gH, sc([
    [0.166, 0.03],
    [0.168, 0.0],
  ]), -open, open, 12);
  const shell = finalize(gH.build('helmShell', scene), m.bronze);
  shell.material!.backFaceCulling = false;


  // Kamm: Flosse von vorn nach hinten über den Scheitel
  const gC = new GeoBuilder();
  const fin: [number, number][] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = -1.0 + (i / steps) * 2.3; // Winkel über dem Kopf (vorn -> hinten)
    const rBase = 0.155 * s;
    const z = Math.cos(a + Math.PI / 2) * -rBase;
    const y = Math.sin(a + Math.PI / 2) * rBase;
    fin.push([z, y]);
  }
  const top: [number, number][] = fin.map(([z, y], i) => {
    const t = i / steps;
    const h = (0.03 + Math.sin(t * Math.PI) * 0.12 + t * 0.02) * s;
    const len = Math.hypot(z, y);
    return [z + (z / len) * h, y + (y / len) * h];
  });
  const th = 0.012 * s;
  for (const side of [-1, 1]) {
    const n = new Vector3(side, 0, 0);
    for (let i = 0; i < steps; i++) {
      const a = gC.vertex(new Vector3(side * th, fin[i][1], fin[i][0]), n, 0, 0);
      const b = gC.vertex(new Vector3(side * th, fin[i + 1][1], fin[i + 1][0]), n, 1, 0);
      const c = gC.vertex(new Vector3(side * th, top[i + 1][1], top[i + 1][0]), n, 1, 1);
      const d = gC.vertex(new Vector3(side * th, top[i][1], top[i][0]), n, 0, 1);
      gC.quad(a, b, c, d);
    }
  }
  for (let i = 0; i < steps; i++) {
    const p0 = new Vector3(0, top[i][1], top[i][0]);
    const p1 = new Vector3(0, top[i + 1][1], top[i + 1][0]);
    const n = new Vector3(0, p1.z - p0.z, -(p1.y - p0.y)).normalize();
    if (n.y < 0) n.scaleInPlace(-1);
    const a = gC.vertex(new Vector3(-th, p0.y, p0.z), n, 0, 0);
    const b = gC.vertex(new Vector3(th, p0.y, p0.z), n, 1, 0);
    const c = gC.vertex(new Vector3(th, p1.y, p1.z), n, 1, 1);
    const d = gC.vertex(new Vector3(-th, p1.y, p1.z), n, 0, 1);
    gC.quad(a, b, c, d);
  }
  const crest = finalize(gC.build('helmCrest', scene), m.bronze);

  // Federbusch aus Rosshaar: überlappende, abgeflachte Ellipsoide entlang des Kamms
  const tufts: Mesh[] = [];
  for (let i = 1; i < steps; i += 1) {
    const [z, y] = top[i];
    const len = Math.hypot(z, y);
    const t = i / steps;
    const h = (0.03 + Math.sin(t * Math.PI) * 0.035) * s;
    const tuft = MeshBuilder.CreateSphere('tuft', { diameterX: 0.04 * s, diameterY: h * 2, diameterZ: 0.06 * s, segments: 8 }, scene);
    tuft.position.set(0, y + (y / len) * h * 0.55, z + (z / len) * h * 0.55);
    tuft.rotation.x = Math.atan2(z, y);
    tufts.push(tuft);
  }
  const plume = Mesh.MergeMeshes(tufts, true, true) as Mesh;
  plume.material = m.plume;
  const helmet = Mesh.MergeMeshes([shell, crest, plume], true, true, undefined, false, true) as Mesh;
  helmet.name = 'helmet';
  helmet.receiveShadows = true;
  return helmet;
}

/* ---------- Manica (Armschutz) ---------- */

export function buildManica(scene: Scene, m: GearMaterials, length: number, radius: number): Mesh {
  const parts: Mesh[] = [];
  const n = Math.max(3, Math.round(length / 0.055));
  for (let i = 0; i < n; i++) {
    const seg = MeshBuilder.CreateCylinder('manicaSeg', {
      height: (length / n) * 1.25,
      diameterTop: radius * 2 * (1 - (i / n) * 0.12),
      diameterBottom: radius * 2 * (1.08 - (i / n) * 0.12),
      tessellation: 14,
    }, scene);
    seg.position.y = (i + 0.5) * (length / n);
    parts.push(seg);
  }
  const mesh = Mesh.MergeMeshes(parts, true, true) as Mesh;
  mesh.name = 'manica';
  return finalize(mesh, m.leather);
}

/* ---------- Beinschiene ---------- */

export function buildGreave(scene: Scene, m: GearMaterials, length: number, radius: number): Mesh {
  const g = new GeoBuilder();
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const r = radius * (1.15 - 0.25 * t + Math.sin(t * Math.PI) * 0.12);
    prof.push([r, -t * length]);
  }
  lathe(g, prof, -1.9, 1.9, 18);
  const mesh = finalize(g.build('greave', scene), m.bronze);
  mesh.material!.backFaceCulling = false;
  return mesh;
}

/* ---------- Gürtel und Lendenschurz ---------- */

export function buildBelt(scene: Scene, m: GearMaterials, rx: number, rz: number): Mesh {
  const g = new GeoBuilder();
  const seg = 28;
  const h = 0.11;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = Math.sin(a) * rx;
    const z = Math.cos(a) * rz;
    const n = new Vector3(Math.sin(a) / rx, 0, Math.cos(a) / rz).normalize();
    g.vertex(new Vector3(x, -h / 2, z), n, i / seg, 0);
    g.vertex(new Vector3(x * 1.02, h / 2, z * 1.02), n, i / seg, 1);
    if (i < seg) {
      const k = i * 2;
      g.quad(k, k + 2, k + 3, k + 1);
    }
  }
  const belt = finalize(g.build('belt', scene), m.bronze);
  // Lendenschurz vorn
  const gc = new GeoBuilder();
  const w0 = rx * 0.9;
  const w1 = rx * 0.75;
  const len = 0.34;
  const n = new Vector3(0, 0.15, 1).normalize();
  const a = gc.vertex(new Vector3(-w0, -h / 2, rz + 0.005), n, 0, 1);
  const b = gc.vertex(new Vector3(w0, -h / 2, rz + 0.005), n, 1, 1);
  const c = gc.vertex(new Vector3(w1, -h / 2 - len, rz + 0.05), n, 1, 0);
  const d = gc.vertex(new Vector3(-w1, -h / 2 - len, rz + 0.05), n, 0, 0);
  gc.quad(a, b, c, d);
  const cloth = finalize(gc.build('subligaculum', scene), m.cloth);
  cloth.material!.backFaceCulling = false;
  const mesh = Mesh.MergeMeshes([belt, cloth], true, true, undefined, false, true) as Mesh;
  mesh.name = 'belt';
  return mesh;
}

/* ======================================================================
 * Klassen-Ausrüstung (Phase 4)
 * ====================================================================== */

/** Flache, beidseitige Klinge entlang +Y aus Querschnitten [y, Breite, x-Versatz] */
function bladeFrom(scene: Scene, name: string, sections: [number, number, number][], th: number, mat: PBRMaterial): Mesh {
  const g = new GeoBuilder();
  for (let k = 0; k < sections.length - 1; k++) {
    const [y0, w0, o0] = sections[k];
    const [y1, w1, o1] = sections[k + 1];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p0 = new Vector3(o0, y0, sz * th);
        const p1 = new Vector3(o0 + (sx * w0) / 2, y0, 0);
        const p2 = new Vector3(o1 + (sx * w1) / 2, y1, 0);
        const p3 = new Vector3(o1, y1, sz * th * (w1 > 0 ? 1 : 0));
        const n = Vector3.Cross(p1.subtract(p0), p3.subtract(p0)).normalize();
        if (n.z * sz < 0) n.scaleInPlace(-1);
        const a = g.vertex(p0, n, 0.5, y0);
        const b = g.vertex(p1, n, 0.5 + sx * 0.5, y0);
        const c = g.vertex(p2, n, 0.5 + sx * 0.5, y1);
        const d = g.vertex(p3, n, 0.5, y1);
        g.quad(a, b, c, d);
      }
    }
  }
  const mesh = g.build(name, scene);
  mesh.material = mat;
  return mesh;
}

function merged(name: string, parts: Mesh[]): Mesh {
  const m = Mesh.MergeMeshes(parts, true, true, undefined, false, true) as Mesh;
  m.name = name;
  m.receiveShadows = true;
  return m;
}

/** Sica: kurze, gebogene Klinge der Thraker */
export function buildSica(scene: Scene, m: GearMaterials): Mesh {
  const secs: [number, number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const y = 0.07 + t * 0.48;
    const w = 0.05 * (1 - t * 0.85) + 0.006;
    const off = -0.16 * t * t; // Krümmung nach vorn
    secs.push([y, i === 8 ? 0 : w, off]);
  }
  const blade = bladeFrom(scene, 'sicaBlade', secs, 0.008, m.iron);
  const grip = MeshBuilder.CreateCylinder('grip', { height: 0.1, diameter: 0.032, tessellation: 10 }, scene);
  grip.material = m.wood;
  const guard = MeshBuilder.CreateBox('guard', { width: 0.07, height: 0.022, depth: 0.045 }, scene);
  guard.position.y = 0.06;
  guard.material = m.bronze;
  const pommel = MeshBuilder.CreateSphere('pommel', { diameter: 0.045, segments: 8 }, scene);
  pommel.position.y = -0.062;
  pommel.material = m.bronze;
  return merged('sica', [blade, grip, guard, pommel]);
}

/** Speer (Hasta): Griff in der Hand, Spitze weit vorn */
export function buildSpear(scene: Scene, m: GearMaterials): Mesh {
  const shaft = MeshBuilder.CreateCylinder('shaft', { height: 1.95, diameter: 0.032, tessellation: 8 }, scene);
  shaft.position.y = 0.35;
  shaft.material = m.wood;
  const head = bladeFrom(scene, 'spearHead', [
    [1.3, 0.012, 0],
    [1.36, 0.06, 0],
    [1.5, 0.0, 0],
  ], 0.01, m.iron);
  const butt = MeshBuilder.CreateCylinder('butt', { height: 0.08, diameterTop: 0.036, diameterBottom: 0.02, tessellation: 8 }, scene);
  butt.position.y = -0.66;
  butt.material = m.bronze;
  return merged('spear', [shaft, head, butt]);
}

/** Dreizack (Fuscina) */
export function buildTrident(scene: Scene, m: GearMaterials): Mesh {
  const shaft = MeshBuilder.CreateCylinder('shaft', { height: 1.75, diameter: 0.034, tessellation: 8 }, scene);
  shaft.position.y = 0.3;
  shaft.material = m.wood;
  const parts: Mesh[] = [shaft];
  const bar = MeshBuilder.CreateBox('bar', { width: 0.2, height: 0.025, depth: 0.025 }, scene);
  bar.position.y = 1.18;
  bar.material = m.iron;
  parts.push(bar);
  for (const x of [-0.09, 0, 0.09]) {
    const prong = MeshBuilder.CreateCylinder('prong', { height: x === 0 ? 0.3 : 0.24, diameterTop: 0.004, diameterBottom: 0.018, tessellation: 6 }, scene);
    prong.position.set(x, 1.18 + (x === 0 ? 0.15 : 0.12), 0);
    prong.material = m.iron;
    parts.push(prong);
    const barb = MeshBuilder.CreateCylinder('barb', { height: 0.05, diameterTop: 0.003, diameterBottom: 0.014, tessellation: 5 }, scene);
    barb.position.set(x + (x <= 0 ? 0.012 : -0.012), 1.18 + (x === 0 ? 0.25 : 0.2), 0);
    barb.rotation.z = x <= 0 ? -0.6 : 0.6;
    barb.material = m.iron;
    parts.push(barb);
  }
  return merged('trident', parts);
}

/** Gewölbter Rechteckschild beliebiger Größe (Front bemalt, Rand Bronze) */
function curvedShield(scene: Scene, m: GearMaterials, W: number, H: number, k: number, name: string): Mesh {
  const t = 0.02;
  const seg = 12;
  const gF = new GeoBuilder();
  const gB = new GeoBuilder();
  const gE = new GeoBuilder();
  const zAt = (x: number) => -k * x * x;
  const front: number[][] = [];
  const back: number[][] = [];
  for (let i = 0; i <= seg; i++) {
    const x = -W / 2 + (W * i) / seg;
    const z = zAt(x);
    const n = new Vector3(2 * k * x, 0, 1).normalize();
    const rowF: number[] = [];
    const rowB: number[] = [];
    for (const [j, y] of [-H / 2, H / 2].entries()) {
      rowF.push(gF.vertex(new Vector3(x, y, z), n, i / seg, j));
      rowB.push(gB.vertex(new Vector3(x, y, z - t), n.scale(-1), (i / seg) * 2, j * 3));
    }
    front.push(rowF);
    back.push(rowB);
  }
  for (let i = 0; i < seg; i++) {
    gF.quad(front[i][0], front[i + 1][0], front[i + 1][1], front[i][1]);
    gB.quad(back[i][0], back[i + 1][0], back[i + 1][1], back[i][1]);
  }
  for (let i = 0; i < seg; i++) {
    const x0 = -W / 2 + (W * i) / seg;
    const x1 = x0 + W / seg;
    for (const y of [-H / 2, H / 2]) {
      const n = new Vector3(0, Math.sign(y), 0);
      const a = gE.vertex(new Vector3(x0, y, zAt(x0) + 0.006), n, 0, 0);
      const b = gE.vertex(new Vector3(x1, y, zAt(x1) + 0.006), n, 1, 0);
      const c = gE.vertex(new Vector3(x1, y, zAt(x1) - t - 0.006), n, 1, 1);
      const d = gE.vertex(new Vector3(x0, y, zAt(x0) - t - 0.006), n, 0, 1);
      gE.quad(a, b, c, d);
    }
  }
  for (const x of [-W / 2, W / 2]) {
    const n = new Vector3(Math.sign(x), 0, 0);
    const z = zAt(x);
    const a = gE.vertex(new Vector3(x, -H / 2, z + 0.006), n, 0, 0);
    const b = gE.vertex(new Vector3(x, H / 2, z + 0.006), n, 1, 0);
    const c = gE.vertex(new Vector3(x, H / 2, z - t - 0.006), n, 1, 1);
    const d = gE.vertex(new Vector3(x, -H / 2, z - t - 0.006), n, 0, 1);
    gE.quad(a, b, c, d);
  }
  const f = finalize(gF.build(name + 'Front', scene), m.shieldFront);
  const b = finalize(gB.build(name + 'Back', scene), m.wood);
  const e = finalize(gE.build(name + 'Rim', scene), m.bronze);
  const boss = MeshBuilder.CreateSphere('boss', { diameter: Math.min(W, H) * 0.3, slice: 0.5, segments: 12 }, scene);
  boss.rotation.x = Math.PI / 2;
  boss.scaling.y = 0.55;
  boss.material = m.bronze;
  return merged(name, [f, b, e, boss]);
}

/** Parmula: kleiner, fast quadratischer Schild des Thraex */
export function buildParmula(scene: Scene, m: GearMaterials): Mesh {
  return curvedShield(scene, m, 0.42, 0.5, 0.9, 'parmula');
}

/** Kleiner Rechteckschild des Provocator */
export function buildProvocatorShield(scene: Scene, m: GearMaterials): Mesh {
  return curvedShield(scene, m, 0.52, 0.78, 1.0, 'provShield');
}

/** Parma: kleiner, gewölbter Rundschild des Hoplomachus */
export function buildParma(scene: Scene, m: GearMaterials): Mesh {
  const R = 0.3;
  const g = new GeoBuilder();
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    prof.push([R * t, 0.07 * (1 - t * t)]);
  }
  // Drehkörper um die Z-Achse: lathe arbeitet um Y, daher danach drehen
  lathe(g, prof.map(([r, y]) => [r, y] as [number, number]), 0, Math.PI * 2, 28);
  const front = g.build('parmaFront', scene);
  front.material = m.bronze;
  front.rotation.x = Math.PI / 2;
  const rim = MeshBuilder.CreateTorus('parmaRim', { diameter: R * 2, thickness: 0.025, tessellation: 32 }, scene);
  rim.rotation.x = Math.PI / 2;
  rim.material = m.bronze;
  const boss = MeshBuilder.CreateSphere('boss', { diameter: 0.09, slice: 0.5, segments: 10 }, scene);
  boss.rotation.x = Math.PI / 2;
  boss.position.z = 0.06;
  boss.material = m.iron;
  const back = MeshBuilder.CreateDisc('parmaBack', { radius: R, tessellation: 28, sideOrientation: Mesh.BACKSIDE }, scene);
  back.material = m.wood;
  return merged('parma', [front, rim, boss, back]);
}

/** Helmschale mit offenem Gesicht */
function helmShell(scene: Scene, m: GearMaterials, s: number, opts: { egg?: boolean; brim?: number; open?: number; neck?: boolean }): Mesh {
  const egg = opts.egg ? 1.18 : 1;
  const dome: [number, number][] = [
    [0.0, 0.165 * egg],
    [0.07, 0.155 * egg],
    [0.12, 0.125 * egg],
    [0.15, 0.075],
    [0.162, 0.02],
  ];
  const lower: [number, number][] = [
    [0.162, 0.02],
    [0.165, -0.05],
    [0.158, -0.115],
  ];
  const sc = (p: [number, number][]) => p.map(([r, y]) => [r * s, y * s] as [number, number]);
  const g = new GeoBuilder();
  lathe(g, sc(dome), 0, Math.PI * 2, 30);
  const open = ((opts.open ?? 68) * Math.PI) / 180;
  lathe(g, sc(lower), open, Math.PI * 2 - open, 24);
  if (opts.brim) {
    const b = opts.brim;
    lathe(g, sc([
      [0.158, -0.115],
      [0.158 + b * 0.5, -0.12],
      [0.158 + b, -0.14],
      [0.162 + b, -0.15],
    ]), open * 0.85, Math.PI * 2 - open * 0.85, 26);
  }
  if (opts.neck) {
    // Nackenschutz
    lathe(g, sc([
      [0.158, -0.115],
      [0.2, -0.16],
      [0.23, -0.19],
    ]), Math.PI - 1.2, Math.PI + 1.2, 16);
  }
  lathe(g, sc([
    [0.166, 0.03],
    [0.168, 0.0],
  ]), -open, open, 12);
  const shell = finalize(g.build('helmShell', scene), m.bronze);
  shell.material!.backFaceCulling = false;
  return shell;
}

/** Kamm über den Scheitel; hook > 0 biegt die Spitze nach vorn (Greif) */
function crest(scene: Scene, m: GearMaterials, s: number, height: number, hook: number): Mesh {
  const g = new GeoBuilder();
  const steps = 14;
  const fin: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -1.0 + (i / steps) * 2.3;
    const rBase = 0.155 * s;
    fin.push([Math.cos(a + Math.PI / 2) * -rBase, Math.sin(a + Math.PI / 2) * rBase]);
  }
  const top: [number, number][] = fin.map(([z, y], i) => {
    const t = i / steps;
    const h = (0.03 + Math.sin(t * Math.PI) * height + (1 - t) * hook) * s;
    const len = Math.hypot(z, y);
    return [z + (z / len) * h + (1 - t) * (1 - t) * hook * 0.6 * s, y + (y / len) * h];
  });
  const th = 0.012 * s;
  for (const side of [-1, 1]) {
    const n = new Vector3(side, 0, 0);
    for (let i = 0; i < steps; i++) {
      const a = g.vertex(new Vector3(side * th, fin[i][1], fin[i][0]), n, 0, 0);
      const b = g.vertex(new Vector3(side * th, fin[i + 1][1], fin[i + 1][0]), n, 1, 0);
      const c = g.vertex(new Vector3(side * th, top[i + 1][1], top[i + 1][0]), n, 1, 1);
      const d = g.vertex(new Vector3(side * th, top[i][1], top[i][0]), n, 0, 1);
      g.quad(a, b, c, d);
    }
  }
  for (let i = 0; i < steps; i++) {
    const p0 = new Vector3(0, top[i][1], top[i][0]);
    const p1 = new Vector3(0, top[i + 1][1], top[i + 1][0]);
    const n = new Vector3(0, p1.z - p0.z, -(p1.y - p0.y)).normalize();
    if (n.y < 0) n.scaleInPlace(-1);
    const a = g.vertex(new Vector3(-th, p0.y, p0.z), n, 0, 0);
    const b = g.vertex(new Vector3(th, p0.y, p0.z), n, 1, 0);
    const c = g.vertex(new Vector3(th, p1.y, p1.z), n, 1, 1);
    const d = g.vertex(new Vector3(-th, p1.y, p1.z), n, 0, 1);
    g.quad(a, b, c, d);
  }
  return finalize(g.build('crest', scene), m.bronze);
}

/** Secutor: glatter, eiförmiger Helm mit niedriger runder Finne */
export function buildHelmetSecutor(scene: Scene, m: GearMaterials, s: number): Mesh {
  const shell = helmShell(scene, m, s, { egg: true, open: 58, neck: true });
  const fin = crest(scene, m, s, 0.035, 0);
  return merged('helmet', [shell, fin]);
}

/** Thraex: Krempe, hoher Kamm mit nach vorn gebogenem Greifenkopf, Federn */
export function buildHelmetThraex(scene: Scene, m: GearMaterials, s: number): Mesh {
  const shell = helmShell(scene, m, s, { brim: 0.07, open: 66 });
  const fin = crest(scene, m, s, 0.1, 0.07);
  const parts = [shell, fin];
  for (const side of [-1, 1]) {
    const f = MeshBuilder.CreateBox('feather', { width: 0.012 * s, height: 0.22 * s, depth: 0.05 * s }, scene);
    f.position.set(side * 0.15 * s, 0.13 * s, -0.01 * s);
    f.rotation.z = -side * 0.25;
    f.material = m.plume;
    parts.push(f);
  }
  return merged('helmet', parts);
}

/** Hoplomachus: Krempe, Federbusch und zwei hohe Federn */
export function buildHelmetHoplomachus(scene: Scene, m: GearMaterials, s: number): Mesh {
  const shell = helmShell(scene, m, s, { brim: 0.06, open: 66 });
  const parts = [shell];
  const tufts: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const a = -0.6 + t * 1.6;
    const tuft = MeshBuilder.CreateSphere('tuft', { diameterX: 0.05 * s, diameterY: 0.1 * s, diameterZ: 0.07 * s, segments: 8 }, scene);
    tuft.position.set(0, Math.cos(a) * 0.19 * s, -Math.sin(a) * 0.19 * s);
    tuft.rotation.x = -a;
    tufts.push(tuft);
  }
  const plume = Mesh.MergeMeshes(tufts, true, true) as Mesh;
  plume.material = m.plume;
  parts.push(plume);
  for (const side of [-1, 1]) {
    const f = MeshBuilder.CreateBox('feather', { width: 0.012 * s, height: 0.32 * s, depth: 0.05 * s }, scene);
    f.position.set(side * 0.16 * s, 0.17 * s, 0);
    f.rotation.z = -side * 0.18;
    f.material = m.plume;
    parts.push(f);
  }
  return merged('helmet', parts);
}

/** Provocator: Helm mit Nackenschutz und Wangenklappen, ohne Kamm */
export function buildHelmetProvocator(scene: Scene, m: GearMaterials, s: number): Mesh {
  const shell = helmShell(scene, m, s, { open: 62, neck: true });
  const parts = [shell];
  for (const side of [-1, 1]) {
    const cheek = MeshBuilder.CreateBox('cheek', { width: 0.012 * s, height: 0.12 * s, depth: 0.09 * s }, scene);
    cheek.position.set(side * 0.155 * s, -0.08 * s, 0.07 * s);
    cheek.rotation.y = side * 0.35;
    cheek.material = m.bronze;
    parts.push(cheek);
  }
  const knob = MeshBuilder.CreateSphere('knob', { diameter: 0.04 * s, segments: 8 }, scene);
  knob.position.y = 0.17 * s;
  knob.material = m.bronze;
  parts.push(knob);
  return merged('helmet', parts);
}

/** Galerus: Schulterschutz des Retiarius (lokales Y = Oberarm abwärts, Z = außen) */
export function buildGalerus(scene: Scene, m: GearMaterials, s: number): Mesh {
  const g = new GeoBuilder();
  const W = 0.2 * s;
  const H = 0.24 * s;
  const seg = 8;
  const rows: number[][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const ang = -0.9 + t * 1.8;
    const row: number[] = [];
    for (let j = 0; j <= 4; j++) {
      const v = j / 4;
      const y = -v * H * 0.7 + H * 0.35;
      const r = 0.09 * s + v * 0.02 * s;
      const p = new Vector3(Math.sin(ang) * r, y + (1 - v) * 0.05 * s * (1 - Math.abs(ang)), Math.cos(ang) * r);
      const n = new Vector3(Math.sin(ang), 0.3, Math.cos(ang)).normalize();
      row.push(g.vertex(p, n, t, v));
    }
    rows.push(row);
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < 4; j++) g.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
  // hochstehender Rand
  const fin = MeshBuilder.CreateBox('galerusFin', { width: W, height: 0.11 * s, depth: 0.012 * s }, scene);
  fin.position.set(0, H * 0.45, 0.06 * s);
  fin.material = m.bronze;
  const plate = finalize(g.build('galerusPlate', scene), m.bronze);
  plate.material!.backFaceCulling = false;
  return merged('galerus', [plate, fin]);
}

/** Cardiophylax: kleiner Brustpanzer des Provocator (Z = vorn) */
export function buildChestPlate(scene: Scene, m: GearMaterials, s: number): Mesh {
  const g = new GeoBuilder();
  const W = 0.3 * s;
  const H = 0.22 * s;
  const seg = 8;
  const rows: number[][] = [];
  for (let i = 0; i <= seg; i++) {
    const x = -W / 2 + (W * i) / seg;
    const z = -1.6 * x * x / s;
    const row: number[] = [];
    for (const [j, y] of [-H / 2, H / 2].entries()) {
      const yy = y - (j === 1 ? Math.abs(x) * 0.6 : 0);
      row.push(g.vertex(new Vector3(x, yy, z), new Vector3(3.2 * x / s, 0, 1).normalize(), i / seg, j));
    }
    rows.push(row);
  }
  for (let i = 0; i < seg; i++) g.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
  const plate = finalize(g.build('cardiophylax', scene), m.bronze);
  plate.material!.backFaceCulling = false;
  for (const x of [-W / 2 + 0.03 * s, W / 2 - 0.03 * s]) {
    const strap = MeshBuilder.CreateBox('strap', { width: 0.025 * s, height: 0.18 * s, depth: 0.01 * s }, scene);
    strap.position.set(x, H / 2 + 0.07 * s, -0.04 * s);
    strap.material = m.leather;
    plate.addChild(strap);
  }
  return plate;
}

/** Wickelbinden (Fasciae) am Bein */
export function buildWraps(scene: Scene, m: GearMaterials, length: number, radius: number): Mesh {
  const parts: Mesh[] = [];
  const n = Math.max(4, Math.round(length / 0.045));
  for (let i = 0; i < n; i++) {
    const t = MeshBuilder.CreateTorus('wrap', { diameter: radius * 2 * (1.05 - (i / n) * 0.2), thickness: 0.018, tessellation: 14 }, scene);
    t.position.y = -(i + 0.5) * (length / n);
    t.rotation.x = (i % 2 ? 0.12 : -0.12);
    parts.push(t);
  }
  const mesh = Mesh.MergeMeshes(parts, true, true) as Mesh;
  mesh.name = 'wraps';
  return finalize(mesh, m.cloth);
}

/** Wurfnetz (flach, für Flug und Fesselung) */
export function buildNet(scene: Scene, m: GearMaterials): Mesh {
  const d = MeshBuilder.CreateDisc('net', { radius: 0.9, tessellation: 18, sideOrientation: Mesh.DOUBLESIDE }, scene);
  d.material = m.grille;
  return d;
}
