import {
  Color3,
  Color4,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PBRMaterial,
  PointLight,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
} from '@babylonjs/core';
import type { QualityProfile } from '../core/quality';
import type { Environment } from '../render/environment';
import { box, disc, GeoBuilder, ringBand, ringFlat, ringSlope } from '../render/geometry';
import { flareTexture, plasterMaps, sandMaps, stoneMaps, tileMaps, woodMaps, type PbrMaps } from '../render/textures';
import type { Arena, Obstacle } from './capua';
import { buildCrowd, type Stands } from './crowd';

/** Kreisraum-Radius der Podiumsmauer; die Ellipse entsteht durch Streckung in x */
const R = 16;
const SX = 1.5;
const H = 4.0;
const GATE = 0.11; // halbe Torbreite (Winkel)
const SEG = 120;

function pbr(scene: Scene, name: string, maps: PbrMaps | null, rough: number, color?: Color3): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  if (maps) {
    m.albedoTexture = maps.albedo;
    m.bumpTexture = maps.normal;
  }
  if (color) m.albedoColor = color;
  m.metallic = 0;
  m.roughness = rough;
  m.maxSimultaneousLights = 6;
  m.environmentIntensity = 0;
  return m;
}

/** Sonnensegel: Leinen mit roten Streifen */
function velumTexture(scene: Scene): DynamicTexture {
  const w = 256;
  const h = 64;
  const tex = new DynamicTexture('velum', { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#d9cdb2';
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 2) {
    ctx.fillStyle = `rgba(120,100,70,${(Math.random() * 0.08).toFixed(3)})`;
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.fillStyle = '#8e2a1e';
  ctx.fillRect(0, 6, w, 5);
  ctx.fillRect(0, h - 11, w, 5);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.update(true);
  return tex;
}

/** Bogenreihe als Wand mit dunklen Öffnungen (Vomitorien, Arkaden) */
function arcade(g: GeoBuilder, gDark: GeoBuilder, r: number, y0: number, y1: number, n: number, open: number, skip?: (a: number) => boolean): void {
  ringBand(g, r, y0, y1, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    if (skip?.(a)) continue;
    const w = (2 * Math.PI * r * open) / n;
    const hh = (y1 - y0) * 0.72;
    box(gDark, Math.cos(a) * (r - 0.03), y0 + hh / 2, Math.sin(a) * (r - 0.03), w, hh, 0.04, 1, -a + Math.PI / 2);
    // Bogen: kleiner Kasten oben als Rundung angedeutet
    box(gDark, Math.cos(a) * (r - 0.03), y0 + hh + 0.12, Math.sin(a) * (r - 0.03), w * 0.7, 0.24, 0.04, 1, -a + Math.PI / 2);
  }
}

export function buildColosseum(scene: Scene, env: Environment, q: QualityProfile): Arena {
  const texSize = q.tier === 'low' ? 256 : 512;
  const matSand = pbr(scene, 'sand', sandMaps(scene, texSize), 0.95, new Color3(1.0, 0.95, 0.9));
  const matTrav = pbr(scene, 'stone', stoneMaps(scene, texSize, 3, [204, 190, 164]), 0.85);
  const matMarble = pbr(scene, 'plaster', plasterMaps(scene), 0.55, new Color3(1.05, 1.03, 1.0));
  const matWood = pbr(scene, 'wood', woodMaps(scene), 0.75);
  const matTiles = pbr(scene, 'tiles', tileMaps(scene), 0.7);
  const matDark = new StandardMaterial('tunnel', scene);
  matDark.diffuseColor = new Color3(0.03, 0.025, 0.02);
  matDark.specularColor = Color3.Black();
  const matBronze = new PBRMaterial('bronzeRail', scene);
  matBronze.albedoColor = new Color3(0.55, 0.36, 0.18);
  matBronze.metallic = 0.8;
  matBronze.roughness = 0.35;
  matBronze.reflectionTexture = env.probe.cubeTexture;
  matBronze.environmentIntensity = 0.35;

  const caster = (m: Mesh) => {
    m.receiveShadows = true;
    m.isPickable = false;
    env.addCaster(m);
    return m;
  };

  /* ---------- Boden mit Falltüren zum Hypogäum ---------- */
  const gFloor = new GeoBuilder();
  disc(gFloor, R + 0.6, 0, 26, 128, 3.5);
  const floor = gFloor.stretchX(SX).build('floor', scene);
  floor.material = matSand;
  floor.receiveShadows = true;
  floor.isPickable = false;
  const gDoors = new GeoBuilder();
  for (const [x, z, rot] of [
    [-9, 4, 0],
    [9, -4, 0],
    [-14, -6, 0.3],
    [14, 6, 0.3],
    [0, 9.5, 1.57],
    [0, -9.5, 1.57],
  ]) {
    box(gDoors, x, 0.012, z, 2.2, 0.025, 1.2, 0.6, rot);
  }
  const doors = gDoors.build('trapdoors', scene);
  doors.material = matWood;
  doors.receiveShadows = true;

  /* ---------- Podiumsmauer (Marmor) mit Haupttoren ---------- */
  const gPod = new GeoBuilder();
  const gPodTop = new GeoBuilder();
  const gDark = new GeoBuilder();
  for (const [a0, a1] of [
    [GATE, Math.PI - GATE],
    [Math.PI + GATE, Math.PI * 2 - GATE],
  ]) {
    ringBand(gPod, R, 0, H, a0, a1, SEG, true, 2, 2);
  }
  ringFlat(gPodTop, R - 0.1, R + 0.4, H, 0, Math.PI * 2, SEG * 2, 1.6);
  ringBand(gPodTop, R - 0.1, H - 0.3, H, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
  for (const g of [0, Math.PI]) {
    ringBand(gPodTop, R, 3.1, H - 0.3, g - GATE, g + GATE, 8, true, 1.6, 1.6);
    const cx = Math.cos(g) * (R + 2.5);
    const cz = Math.sin(g) * (R + 2.5);
    box(gDark, cx, 1.55, cz, 4.4, 3.1, 4.4, 2, -g);
    for (const side of [-1, 1]) {
      const a = g + side * (GATE + 0.012);
      box(gPodTop, Math.cos(a) * (R + 0.2), H / 2, Math.sin(a) * (R + 0.2), 0.6, H, 0.8, 1.2, -a + Math.PI / 2);
    }
  }
  const pod = gPod.stretchX(SX).build('podium', scene);
  pod.material = matMarble;
  caster(pod);
  const podTop = gPodTop.stretchX(SX).build('podiumTop', scene);
  podTop.material = matTrav;
  caster(podTop);

  // Bronzegeländer auf dem Podium
  const gRail = new GeoBuilder();
  ringBand(gRail, R + 0.25, H + 0.95, H + 1.02, 0, Math.PI * 2, SEG * 2, true, 1, 1);
  ringBand(gRail, R + 0.25, H + 0.95, H + 1.02, 0, Math.PI * 2, SEG * 2, false, 1, 1);
  const railMesh = gRail.stretchX(SX).build('rail', scene);
  railMesh.material = matBronze;
  const post = MeshBuilder.CreateCylinder('railPost', { height: 1.0, diameter: 0.05, tessellation: 6 }, scene);
  post.material = matBronze;
  const posts: Matrix[] = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    posts.push(Matrix.Translation(Math.cos(a) * (R + 0.25) * SX, H + 0.5, Math.sin(a) * (R + 0.25)));
  }
  post.thinInstanceAdd(posts);

  /* ---------- Ränge ---------- */
  const sections: Stands[] = [];
  const gSteps = new GeoBuilder();
  const steps = (r0: number, y0: number, n: number, depth: number, rise: number) => {
    let r = r0;
    let y = y0;
    for (let i = 0; i < n; i++) {
      ringBand(gSteps, r, y, y + rise, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
      ringFlat(gSteps, r, r + depth, y + rise, 0, Math.PI * 2, SEG * 2, 1.6);
      r += depth;
      y += rise;
    }
    sections.push({ r0, y0, steps: n, depth, rise });
    return { r, y };
  };
  // Senatorenplätze (breite Stufen)
  ringFlat(gSteps, R + 0.4, R + 0.7, H, 0, Math.PI * 2, SEG * 2, 1.6);
  const s1 = steps(R + 0.7, H, 3, 1.0, 0.35);
  // Mauer (Balteus) und erster Rang
  const gWalls = new GeoBuilder();
  arcade(gWalls, gDark, s1.r + 0.05, s1.y, s1.y + 1.6, 24, 0.12, (a) => Math.abs(a - Math.PI / 2) < 0.2);
  ringFlat(gWalls, s1.r, s1.r + 0.4, s1.y + 1.6, 0, Math.PI * 2, SEG * 2, 1.6);
  const s2 = steps(s1.r + 0.4, s1.y + 1.6, 12, 0.8, 0.5);
  arcade(gWalls, gDark, s2.r + 0.05, s2.y, s2.y + 1.9, 40, 0.18);
  ringFlat(gWalls, s2.r, s2.r + 0.4, s2.y + 1.9, 0, Math.PI * 2, SEG * 2, 1.6);
  const s3 = steps(s2.r + 0.4, s2.y + 1.9, 11, 0.8, 0.56);
  // Oberer Säulengang (Holzränge des Volkes) und Attika
  const topY = s3.y;
  const r0 = s3.r;
  ringFlat(gWalls, r0, r0 + 3.2, topY, 0, Math.PI * 2, SEG * 2, 1.6);
  arcade(gWalls, gDark, r0 + 3.2, topY, topY + 5.5, 80, 0.35);
  ringBand(gWalls, r0 + 0.25, topY + 4.4, topY + 5.1, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
  ringFlat(gWalls, r0 + 0.25, r0 + 1.3, topY + 4.4, 0, Math.PI * 2, SEG * 2, 1.6, true);
  // Attika über allem
  ringBand(gWalls, r0 + 3.4, topY + 5.5, topY + 9, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
  ringFlat(gWalls, r0 + 3.4, r0 + 4.4, topY + 9, 0, Math.PI * 2, SEG * 2, 1.6);
  const stepsMesh = gSteps.stretchX(SX).build('steps', scene);
  stepsMesh.material = matTrav;
  caster(stepsMesh);
  const walls = gWalls.stretchX(SX).build('cavea', scene);
  walls.material = matTrav;
  caster(walls);
  const dark = gDark.stretchX(SX).build('openings', scene);
  dark.material = matDark;
  dark.isPickable = false;

  const gRoof = new GeoBuilder();
  ringSlope(gRoof, r0 + 0.1, topY + 5.5, r0 + 3.4, topY + 4.9, 0, Math.PI * 2, SEG * 2, 1.2);
  const roof = gRoof.stretchX(SX).build('roof', scene);
  roof.material = matTiles;
  caster(roof);

  // Säulen des oberen Gangs
  const col = MeshBuilder.CreateCylinder('column', { height: 4.4, diameterTop: 0.36, diameterBottom: 0.44, tessellation: 12 }, scene);
  col.material = matTrav;
  col.receiveShadows = true;
  const cols: Matrix[] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    cols.push(Matrix.Translation(Math.cos(a) * (r0 + 0.75) * SX, topY + 2.2, Math.sin(a) * (r0 + 0.75)));
  }
  col.thinInstanceAdd(cols);
  env.addCaster(col);

  /* ---------- Sonnensegel (Velarium) ---------- */
  const velR0 = r0 + 4.2;
  const velY0 = topY + 9.4;
  const velR1 = s1.r + 6;
  const velY1 = topY + 4.2;
  const gVel = new GeoBuilder();
  const strips = 48;
  for (let i = 0; i < strips; i++) {
    if (i % 2 === 1) continue; // Lücken zwischen den Bahnen
    const a0 = (i / strips) * Math.PI * 2;
    const a1 = ((i + 1) / strips) * Math.PI * 2;
    ringSlope(gVel, velR0, velY0, velR1, velY1, a0, a1, 3, 6);
    ringSlope(gVel, velR1, velY1, velR0, velY0, a0, a1, 3, 6);
  }
  const velum = gVel.stretchX(SX).build('velarium', scene);
  const mv = new PBRMaterial('velumMat', scene);
  mv.albedoTexture = velumTexture(scene);
  mv.roughness = 0.95;
  mv.metallic = 0;
  mv.environmentIntensity = 0;
  mv.backFaceCulling = false;
  mv.twoSidedLighting = true;
  velum.material = mv;
  caster(velum);
  // Masten auf der Attika
  const mast = MeshBuilder.CreateCylinder('mast', { height: 7, diameter: 0.22, tessellation: 6 }, scene);
  mast.material = matWood;
  const masts: Matrix[] = [];
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    masts.push(Matrix.Translation(Math.cos(a) * (r0 + 4.0) * SX, topY + 12, Math.sin(a) * (r0 + 4.0)));
  }
  mast.thinInstanceAdd(masts);
  env.addCaster(mast);

  /* ---------- Fahnen am Podium ---------- */
  const banner = MeshBuilder.CreatePlane('banner', { width: 1.4, height: 2.4 }, scene);
  const mb = pbr(scene, 'banner', null, 0.9, new Color3(0.5, 0.06, 0.05));
  mb.backFaceCulling = false;
  banner.material = mb;
  const bannerAngles = [0.45, 1.1, 2.04, 2.69, 3.6, 4.25, 5.17, 5.83];
  bannerAngles.forEach((a, i) => {
    const b = i === 0 ? banner : banner.createInstance('banner' + i);
    const px = Math.cos(a) * (R - 0.04) * SX;
    const pz = Math.sin(a) * (R - 0.04);
    b.position.set(px, H - 1.5, pz);
    b.rotation.y = -a - Math.PI / 2;
  });

  /* ---------- Feuerbecken auf dem Podium ---------- */
  const flame = flareTexture(scene, 'flame', 'rgba(255,240,200,1)', 'rgba(255,120,30,0.8)');
  const fires: { light: PointLight | null; base: number }[] = [];
  const brazier = [0.3, 2.84, 3.44, 5.98];
  for (const ba of brazier) {
    const bx = Math.cos(ba) * (R - 1.2) * SX;
    const bz = Math.sin(ba) * (R - 1.2);
    const bowl = MeshBuilder.CreateSphere('bowl', { diameter: 0.8, slice: 0.5, segments: 14, sideOrientation: Mesh.DOUBLESIDE }, scene);
    bowl.rotation.x = Math.PI;
    bowl.position.set(bx, 1.25, bz);
    bowl.material = matBronze;
    const stand = MeshBuilder.CreateCylinder('stand', { height: 1.25, diameterTop: 0.12, diameterBottom: 0.35, tessellation: 8 }, scene);
    stand.position.set(bx, 0.62, bz);
    stand.material = matBronze;
    env.addCaster(stand);
    const ps = new ParticleSystem('fire', q.fireParticles, scene);
    ps.particleTexture = flame;
    ps.emitter = new Vector3(bx, 1.3, bz);
    ps.minEmitBox = new Vector3(-0.2, 0, -0.2);
    ps.maxEmitBox = new Vector3(0.2, 0.05, 0.2);
    ps.color1 = new Color4(1, 0.75, 0.35, 1);
    ps.color2 = new Color4(1, 0.45, 0.12, 1);
    ps.colorDead = new Color4(0.3, 0.05, 0, 0);
    ps.minSize = 0.2;
    ps.maxSize = 0.5;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.6;
    ps.emitRate = q.fireParticles * 1.6;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new Vector3(0, 2.6, 0);
    ps.direction1 = new Vector3(-0.2, 1, -0.2);
    ps.direction2 = new Vector3(0.2, 1.4, 0.2);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.8;
    ps.start();
    let light: PointLight | null = null;
    if (q.tier === 'ultra' || q.tier === 'high') {
      light = new PointLight('fireLight', new Vector3(bx, 1.9, bz), scene);
      light.diffuse = new Color3(1, 0.55, 0.22);
      light.range = 12;
    }
    fires.push({ light, base: Math.random() * 10 });
  }
  const obstacles: Obstacle[] = brazier.map((ba) => ({ x: Math.cos(ba) * (R - 1.2) * SX, z: Math.sin(ba) * (R - 1.2), r: 0.5 }));

  /* ---------- Publikum ---------- */
  const max = { ultra: 9000, high: 6000, medium: 3800, low: 1800 }[q.tier];
  const crowd = buildCrowd(scene, env, q, sections, {
    sx: SX,
    max,
    senate: [0],
    pulvinar: { baseR: R + 0.5, floorY: H + 1.4, frontY: H },
  });

  let t = 0;
  return {
    kind: 'colosseum',
    obstacles,
    crowd,
    play: { a: (R - 0.8) * SX, b: R - 0.8 },
    wall: { a: R * SX, b: R },
    update(dt: number, daylight: number) {
      t += dt;
      crowd.update(dt);
      for (const f of fires) {
        if (!f.light) continue;
        const flick = 0.85 + Math.sin(t * 13 + f.base) * 0.08 + Math.sin(t * 27.3 + f.base * 2) * 0.06;
        f.light.intensity = (2.5 + (1 - daylight) * 10) * flick;
      }
    },
  };
}
