import { embers } from './fire';
import {
  Color3,
  Color4,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PBRMaterial,
  PointLight,
  Quaternion,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
} from '@babylonjs/core';
import type { QualityProfile } from '../core/quality';
import type { Environment } from '../render/environment';
import { buildCrowd, type Crowd } from './crowd';
import { box, disc, GeoBuilder, ringBand, ringFlat, ringSlope } from '../render/geometry';
import {
  clothMaps,
  flareTexture,
  noiseAlbedo,
  plasterMaps,
  sandMaps,
  stoneMaps,
  tileMaps,
  woodMaps,
  type PbrMaps,
} from '../render/textures';

/** Maße der Arena (Meter) */
export const ARENA = {
  radius: 16.4, // Innenkante der Podiumsmauer
  wallHeight: 3.2,
  gateHalfAngle: 0.105, // halbe Torbreite als Winkel (≈ 3,4 m Torbreite)
  gates: [0, Math.PI],
  playRadius: 15.6,
};

export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

export type ArenaKind = 'capua' | 'colosseum';

export const ARENA_NAMES: Record<ArenaKind, string> = {
  capua: 'Ludus von Capua',
  colosseum: 'Kolosseum',
};

export interface Arena {
  kind: ArenaKind;
  obstacles: Obstacle[];
  crowd: Crowd;
  /** Spielfläche als Ellipse (Halbachsen x, z) */
  play: { a: number; b: number };
  /** Mauer innen, für die Kamera */
  wall: { a: number; b: number };
  /** Höhe der Podiumsmauer (Fackeln obenauf) */
  podiumHeight: number;
  update(dt: number, daylight: number): void;
}

function pbr(scene: Scene, name: string, maps: PbrMaps | null, rough: number, metal = 0, color?: Color3): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  if (maps) {
    m.albedoTexture = maps.albedo;
    m.bumpTexture = maps.normal;
    m.bumpTexture.level = 1;
  }
  if (color) m.albedoColor = color;
  m.metallic = metal;
  m.roughness = rough;
  m.maxSimultaneousLights = 6;
  m.environmentIntensity = 0;
  return m;
}

export function buildCapua(scene: Scene, env: Environment, q: QualityProfile): Arena {
  const texSize = q.tier === 'low' ? 256 : 512;
  const sand = sandMaps(scene, texSize);
  const stone = stoneMaps(scene, texSize);
  const plaster = plasterMaps(scene);
  const wood = woodMaps(scene);
  const tiles = tileMaps(scene);

  const matSand = pbr(scene, 'sand', sand, 0.95);
  const matStone = pbr(scene, 'stone', stone, 0.88);
  const matPlaster = pbr(scene, 'plaster', plaster, 0.8);
  const matWood = pbr(scene, 'wood', wood, 0.75);
  const matTiles = pbr(scene, 'tiles', tiles, 0.7);
  const matBronze = pbr(scene, 'bronzeProp', null, 0.38, 1, new Color3(0.72, 0.45, 0.22));
  matBronze.albedoTexture = noiseAlbedo(scene, 'bronzeNoise', [255, 255, 255], 0.35, 8);
  matBronze.reflectionTexture = env.probe.cubeTexture;
  matBronze.environmentIntensity = 0.3;
  const matDark = new StandardMaterial('tunnel', scene);
  matDark.diffuseColor = new Color3(0.04, 0.03, 0.025);
  matDark.specularColor = Color3.Black();

  const R = ARENA.radius;
  const H = ARENA.wallHeight;
  const gh = ARENA.gateHalfAngle;
  const SEG = 72;

  /* ---------- Boden ---------- */
  const gFloor = new GeoBuilder();
  disc(gFloor, R + 0.5, 0, 24, 96, 3.5);
  const floor = gFloor.build('floor', scene);
  floor.material = matSand;
  floor.receiveShadows = true;
  floor.isPickable = false;

  /* ---------- Podiumsmauer mit zwei Toren ---------- */
  const gWall = new GeoBuilder();
  const gTop = new GeoBuilder();
  // Bereiche zwischen den Toren
  const spans: [number, number][] = [
    [gh, Math.PI - gh],
    [Math.PI + gh, Math.PI * 2 - gh],
  ];
  for (const [a0, a1] of spans) {
    ringBand(gWall, R, 0, H, a0, a1, SEG, true, 8, H);
  }
  // Mauerkrone (ganzer Ring, läuft über die Tore)
  ringFlat(gTop, R - 0.05, R + 0.7, H, 0, Math.PI * 2, SEG * 2, 1.6);
  ringBand(gTop, R - 0.05, H - 0.35, H, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
  // Sturz über den Toren
  for (const g of ARENA.gates) {
    ringBand(gTop, R, 2.7, H - 0.35, g - gh, g + gh, 8, true, 1.6, 1.6);
  }
  const wall = gWall.build('podium', scene);
  wall.material = matPlaster;
  wall.receiveShadows = true;
  const wallTop = gTop.build('podiumTop', scene);
  wallTop.material = matStone;
  wallTop.receiveShadows = true;
  env.addCaster(wallTop);

  /* ---------- Tore: Pfeiler, Tunnel, Fallgitter ---------- */
  const gGate = new GeoBuilder();
  const gGrid = new GeoBuilder();
  const gTunnel = new GeoBuilder();
  for (const g of ARENA.gates) {
    for (const side of [-1, 1]) {
      const a = g + side * (gh + 0.012);
      box(gGate, Math.cos(a) * (R + 0.15), H / 2 - 0.15, Math.sin(a) * (R + 0.15), 0.55, H - 0.3, 0.75, 1.2, -a + Math.PI / 2);
    }
    // Tunnel (dunkler Kasten hinter dem Tor)
    const cx = Math.cos(g) * (R + 2.2);
    const cz = Math.sin(g) * (R + 2.2);
    box(gTunnel, cx, 1.35, cz, 4.2, 2.7, 3.6, 2, -g);
    // Fallgitter aus Holz
    const ga = g;
    const gr = R + 0.75;
    const width = 2 * gh * R;
    const tang = new Vector3(-Math.sin(ga), 0, Math.cos(ga));
    for (let i = 0; i <= 7; i++) {
      const off = -width / 2 + 0.15 + (i * (width - 0.3)) / 7;
      box(gGrid, Math.cos(ga) * gr + tang.x * off, 1.32, Math.sin(ga) * gr + tang.z * off, 0.09, 2.64, 0.09, 0.5, -ga);
    }
    for (const yy of [0.5, 1.4, 2.3]) {
      box(gGrid, Math.cos(ga) * (gr + 0.07), yy, Math.sin(ga) * (gr + 0.07), 0.07, 0.1, width - 0.1, 0.5, -ga);
    }
  }
  const gates = gGate.build('gatePillars', scene);
  gates.material = matStone;
  gates.receiveShadows = true;
  env.addCaster(gates);
  const tunnel = gTunnel.build('tunnel', scene);
  tunnel.material = matDark;
  tunnel.flipFaces(true);
  const grid = gGrid.build('portcullis', scene);
  grid.material = matWood;
  env.addCaster(grid);

  /* ---------- Sitzstufen ---------- */
  const gSteps = new GeoBuilder();
  const steps = 8;
  const depth = 0.8;
  const rise = 0.45;
  let r = R + 0.7;
  let y = H;
  for (let i = 0; i < steps; i++) {
    ringBand(gSteps, r, y, y + rise, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
    ringFlat(gSteps, r, r + depth, y + rise, 0, Math.PI * 2, SEG * 2, 1.6);
    r += depth;
    y += rise;
  }
  const crowd = buildCrowd(scene, env, q, [{ r0: R + 0.7, y0: H, steps, depth, rise }]);
  const stepsMesh = gSteps.build('steps', scene);
  stepsMesh.material = matStone;
  stepsMesh.receiveShadows = true;
  env.addCaster(stepsMesh);

  /* ---------- Säulengang oben ---------- */
  const floorY = y; // 6.8
  const r0 = r; // ≈ 23.5
  const gUpper = new GeoBuilder();
  ringFlat(gUpper, r0, r0 + 2.6, floorY, 0, Math.PI * 2, SEG * 2, 1.6);
  ringBand(gUpper, r0 + 2.6, floorY, floorY + 3.9, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
  // Gebälk
  const ent0 = floorY + 3.4;
  ringBand(gUpper, r0 + 0.25, ent0, ent0 + 0.6, 0, Math.PI * 2, SEG * 2, true, 1.6, 1.6);
  ringFlat(gUpper, r0 + 0.25, r0 + 1.2, ent0, 0, Math.PI * 2, SEG * 2, 1.6, true);
  const upper = gUpper.build('colonnadeStone', scene);
  upper.material = matStone;
  upper.receiveShadows = true;
  env.addCaster(upper);
  const gRoof = new GeoBuilder();
  ringSlope(gRoof, r0 + 0.1, ent0 + 0.95, r0 + 2.9, ent0 + 0.35, 0, Math.PI * 2, SEG * 2, 1.2);
  ringSlope(gRoof, r0 + 0.1, ent0 + 0.6, r0 + 0.1, ent0 + 0.95, 0, Math.PI * 2, SEG * 2, 1.2);
  const roof = gRoof.build('roof', scene);
  roof.material = matTiles;
  roof.receiveShadows = true;
  env.addCaster(roof);

  // Säulen als Instanzen
  const gCol = new GeoBuilder();
  box(gCol, 0, 0.12, 0, 0.62, 0.24, 0.62, 0.8);
  box(gCol, 0, 3.4 - 0.14, 0, 0.6, 0.28, 0.6, 0.8);
  const colBase = gCol.build('colBlocks', scene);
  const shaft = MeshBuilder.CreateCylinder('shaft', { height: 2.96, diameterTop: 0.36, diameterBottom: 0.44, tessellation: 14 }, scene);
  shaft.position.y = 0.24 + 1.48;
  const column = Mesh.MergeMeshes([colBase, shaft], true, true) as Mesh;
  column.name = 'column';
  column.material = matStone;
  column.receiveShadows = true;
  const nCols = 44;
  const mats: Matrix[] = [];
  for (let i = 0; i < nCols; i++) {
    const a = (i / nCols) * Math.PI * 2 + Math.PI / nCols;
    mats.push(Matrix.Translation(Math.cos(a) * (r0 + 0.72), floorY, Math.sin(a) * (r0 + 0.72)));
  }
  column.thinInstanceAdd(mats);
  env.addCaster(column);

  /* ---------- Fahnen ---------- */
  const red = clothMaps(scene, [150, 28, 22]);
  const matBanner = pbr(scene, 'banner', red, 0.9);
  matBanner.backFaceCulling = false;
  matBanner.twoSidedLighting = true;
  const banner = MeshBuilder.CreatePlane('banner', { width: 1.1, height: 2.6 }, scene);
  banner.material = matBanner;
  const nBan = 12;
  env.addCaster(banner);
  for (let i = 0; i < nBan; i++) {
    const a = (i / nBan) * Math.PI * 2 + Math.PI / nBan + 0.04;
    const b = i === 0 ? banner : banner.createInstance('banner' + i);
    const rr = r0 + 0.2;
    b.position.set(Math.cos(a) * rr, ent0 - 1.3, Math.sin(a) * rr);
    b.rotationQuaternion = Quaternion.FromEulerAngles(0, -a - Math.PI / 2, 0);
  }

  /* ---------- Requisiten: Pfähle, Waffengestell, Feuerbecken ---------- */
  const obstacles: Obstacle[] = [];
  const gPost = new GeoBuilder();
  const posts = [
    [-5.5, 6],
    [6.5, -4.5],
    [-7.5, -6.5],
  ];
  for (const [px, pz] of posts) {
    box(gPost, px, 0.95, pz, 0.26, 1.9, 0.26, 0.6, Math.random());
    obstacles.push({ x: px, z: pz, r: 0.35 });
  }
  const postsMesh = gPost.build('pali', scene);
  postsMesh.material = matWood;
  postsMesh.receiveShadows = true;
  env.addCaster(postsMesh);
  const matRope = pbr(scene, 'rope', clothMaps(scene, [168, 140, 98]), 0.95);
  for (const [px, pz] of posts) {
    for (const yy of [0.9, 1.3, 1.6]) {
      const t = MeshBuilder.CreateTorus('rope', { diameter: 0.33, thickness: 0.05, tessellation: 12 }, scene);
      t.position.set(px, yy, pz);
      t.material = matRope;
      env.addCaster(t);
    }
  }

  // Waffengestell an der Mauer
  const rackA = 2.3;
  const rackX = Math.cos(rackA) * (R - 0.6);
  const rackZ = Math.sin(rackA) * (R - 0.6);
  const gRack = new GeoBuilder();
  const rot = -rackA + Math.PI / 2;
  const tx = Math.cos(rot);
  const tz = -Math.sin(rot);
  box(gRack, rackX - tx * 1.0, 0.75, rackZ - tz * 1.0, 0.1, 1.5, 0.1, 0.5, rot);
  box(gRack, rackX + tx * 1.0, 0.75, rackZ + tz * 1.0, 0.1, 1.5, 0.1, 0.5, rot);
  box(gRack, rackX, 1.42, rackZ, 2.2, 0.08, 0.12, 0.5, rot);
  box(gRack, rackX, 0.35, rackZ, 2.2, 0.08, 0.3, 0.5, rot);
  for (let i = 0; i < 5; i++) {
    const off = -0.8 + i * 0.4;
    box(gRack, rackX + tx * off, 0.85, rackZ + tz * off, 0.05, 1.1, 0.04, 0.5, rot);
  }
  const rack = gRack.build('rack', scene);
  rack.material = matWood;
  env.addCaster(rack);
  obstacles.push({ x: rackX, z: rackZ, r: 1.1 });

  // Feuerbecken
  const flame = flareTexture(scene, 'flame', 'rgba(255,240,200,1)', 'rgba(255,120,30,0.8)');
  const smoke = flareTexture(scene, 'smoke', 'rgba(60,55,50,0.5)', 'rgba(40,35,30,0.25)');
  const fires: { light: PointLight | null; ps: ParticleSystem; base: number }[] = [];
  const brazierAngles = [0.62, 2.55, 3.72, 5.66];
  for (const ba of brazierAngles) {
    const bx = Math.cos(ba) * (R - 1.4);
    const bz = Math.sin(ba) * (R - 1.4);
    const bowl = MeshBuilder.CreateSphere('bowl', { diameter: 0.75, slice: 0.5, segments: 16, sideOrientation: Mesh.DOUBLESIDE }, scene);
    bowl.rotation.x = Math.PI;
    bowl.position.set(bx, 1.15, bz);
    bowl.material = matBronze;
    env.addCaster(bowl);
    for (let k = 0; k < 3; k++) {
      const leg = MeshBuilder.CreateCylinder('leg', { height: 1.25, diameter: 0.05, tessellation: 6 }, scene);
      const la = (k / 3) * Math.PI * 2;
      leg.position.set(bx + Math.cos(la) * 0.2, 0.6, bz + Math.sin(la) * 0.2);
      leg.rotation.set(Math.sin(la) * -0.25, 0, Math.cos(la) * 0.25);
      leg.material = matBronze;
      env.addCaster(leg);
    }
    obstacles.push({ x: bx, z: bz, r: 0.45 });

    const ps = new ParticleSystem('fire', q.fireParticles, scene);
    ps.particleTexture = flame;
    ps.emitter = new Vector3(bx, 1.2, bz);
    ps.minEmitBox = new Vector3(-0.18, 0, -0.18);
    ps.maxEmitBox = new Vector3(0.18, 0.05, 0.18);
    ps.color1 = new Color4(1, 0.75, 0.35, 1);
    ps.color2 = new Color4(1, 0.45, 0.12, 1);
    ps.colorDead = new Color4(0.3, 0.05, 0, 0);
    ps.minSize = 0.18;
    ps.maxSize = 0.45;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.6;
    ps.emitRate = q.fireParticles * 1.6;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new Vector3(0, 2.6, 0);
    ps.direction1 = new Vector3(-0.2, 1, -0.2);
    ps.direction2 = new Vector3(0.2, 1.4, 0.2);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.8;
    ps.updateSpeed = 0.016;
    ps.start();

    const sm = new ParticleSystem('smoke', 40, scene);
    sm.particleTexture = smoke;
    sm.emitter = new Vector3(bx, 1.7, bz);
    sm.minSize = 0.4;
    sm.maxSize = 1.1;
    sm.minLifeTime = 1.5;
    sm.maxLifeTime = 3;
    sm.emitRate = 10;
    sm.color1 = new Color4(0.25, 0.22, 0.2, 0.35);
    sm.color2 = new Color4(0.2, 0.18, 0.16, 0.25);
    sm.colorDead = new Color4(0.2, 0.2, 0.2, 0);
    sm.gravity = new Vector3(0.2, 0.6, 0);
    sm.direction1 = new Vector3(-0.1, 1, -0.1);
    sm.direction2 = new Vector3(0.1, 1, 0.1);
    sm.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    sm.start();
    embers(scene, new Vector3(bx, 1.25, bz), q);

    let light: PointLight | null = null;
    if (q.tier === 'ultra' || q.tier === 'high') {
      light = new PointLight('fireLight', new Vector3(bx, 1.8, bz), scene);
      light.diffuse = new Color3(1, 0.55, 0.22);
      light.specular = new Color3(1, 0.5, 0.2);
      light.range = 11;
    }
    fires.push({ light, ps, base: Math.random() * 10 });
  }

  // Staub in der Luft kommt jetzt aus der Kino-Ebene (render/cinema.ts)

  /* ---------- Landschaft: Hügel, Vesuv, Zypressen ---------- */
  buildLandscape(scene);

  let t = 0;
  return {
    kind: 'capua',
    obstacles,
    crowd,
    play: { a: ARENA.playRadius, b: ARENA.playRadius },
    wall: { a: ARENA.radius, b: ARENA.radius },
    podiumHeight: ARENA.wallHeight,
    update(dt: number, daylight: number) {
      t += dt;
      crowd.update(dt);
      for (const f of fires) {
        if (!f.light) continue;
        const flick = 0.85 + Math.sin(t * 13 + f.base) * 0.08 + Math.sin(t * 27.3 + f.base * 2) * 0.06;
        f.light.intensity = (2.5 + (1 - daylight) * 3.5) * flick;
      }
    },
  };
}

function buildLandscape(scene: Scene): void {
  const matHill = new StandardMaterial('hill', scene);
  matHill.diffuseColor = new Color3(0.38, 0.4, 0.26);
  matHill.specularColor = Color3.Black();
  const g = new GeoBuilder();
  const seg = 96;
  const r1 = 170;
  const r2 = 420;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const hgt = 18 + Math.sin(a * 3.1) * 10 + Math.sin(a * 7.3 + 1) * 6 + Math.sin(a * 13.7) * 3;
    const n = new Vector3(-Math.cos(a) * 0.4, 1, -Math.sin(a) * 0.4).normalize();
    g.vertex(new Vector3(Math.cos(a) * r1, -2, Math.sin(a) * r1), n, 0, 0);
    g.vertex(new Vector3(Math.cos(a) * r2, hgt, Math.sin(a) * r2), n, 0, 1);
    if (i < seg) {
      const k = i * 2;
      g.quad(k, k + 2, k + 3, k + 1);
    }
  }
  const hills = g.build('hills', scene);
  hills.material = matHill;
  hills.isPickable = false;

  // Vesuv
  const ves = MeshBuilder.CreateCylinder('vesuv', { height: 120, diameterTop: 60, diameterBottom: 520, tessellation: 40 }, scene);
  ves.position.set(-260, 50, 380);
  const matV = new StandardMaterial('vesuvMat', scene);
  matV.diffuseColor = new Color3(0.36, 0.36, 0.3);
  matV.specularColor = Color3.Black();
  ves.material = matV;
  // Rauchfahne
  const smoke = flareTexture(scene, 'vsmoke', 'rgba(200,195,190,0.45)', 'rgba(170,165,160,0.2)');
  const ps = new ParticleSystem('vesuvSmoke', 60, scene);
  ps.particleTexture = smoke;
  ps.emitter = new Vector3(-260, 112, 380);
  ps.minEmitBox = new Vector3(-12, 0, -12);
  ps.maxEmitBox = new Vector3(12, 0, 12);
  ps.minSize = 25;
  ps.maxSize = 55;
  ps.minLifeTime = 12;
  ps.maxLifeTime = 20;
  ps.emitRate = 4;
  ps.gravity = new Vector3(3, 2, 0);
  ps.direction1 = new Vector3(0, 1, 0);
  ps.direction2 = new Vector3(0.4, 1, 0);
  ps.minEmitPower = 1;
  ps.maxEmitPower = 2;
  ps.color1 = new Color4(0.8, 0.78, 0.75, 0.35);
  ps.color2 = new Color4(0.7, 0.68, 0.65, 0.25);
  ps.colorDead = new Color4(0.7, 0.7, 0.7, 0);
  ps.preWarmCycles = 400;
  ps.start();

  // Zypressen
  const matTree = new StandardMaterial('cypress', scene);
  matTree.diffuseColor = new Color3(0.12, 0.2, 0.1);
  matTree.specularColor = Color3.Black();
  const tree = MeshBuilder.CreateCylinder('tree', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 8 }, scene);
  tree.material = matTree;
  const mats: Matrix[] = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = 45 + Math.random() * 90;
    const h = 9 + Math.random() * 7;
    const w = 1.6 + Math.random() * 0.9;
    mats.push(Matrix.Scaling(w, h, w).multiply(Matrix.Translation(Math.cos(a) * rr, h / 2 - 1, Math.sin(a) * rr)));
  }
  tree.thinInstanceAdd(mats);
  // Boden außerhalb
  const ground = MeshBuilder.CreateGround('outerGround', { width: 900, height: 900 }, scene);
  ground.position.y = -0.6;
  const matG = new StandardMaterial('outerG', scene);
  matG.diffuseColor = new Color3(0.42, 0.38, 0.26);
  matG.specularColor = Color3.Black();
  ground.material = matG;
  const tex = noiseAlbedo(scene, 'outerNoise', [255, 255, 255], 0.4, 4);
  tex.uScale = 40;
  tex.vScale = 40;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  matG.diffuseTexture = tex;
}
