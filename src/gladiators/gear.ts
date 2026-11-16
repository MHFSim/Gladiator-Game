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
