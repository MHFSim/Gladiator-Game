import {
  Color3,
  Material,
  MaterialDefines,
  MaterialPluginBase,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  ShaderLanguage,
  UniformBuffer,
  Vector3,
  VertexBuffer,
  type AbstractEngine,
  type SubMesh,
} from '@babylonjs/core';
import type { QualityProfile } from '../core/quality';
import type { Environment } from '../render/environment';
import { box, GeoBuilder } from '../render/geometry';
import { clothMaps, plasterMaps } from '../render/textures';

/** Lage der Sitzreihen (aus der Arena) */
export interface Stands {
  r0: number; // Innenkante der ersten Stufe
  y0: number; // Oberkante der Podiumsmauer
  steps: number;
  depth: number;
  rise: number;
}

/** Winkel der Kaiserloge (Blick vom Spieler beim Start) */
export const PULVINAR_ANGLE = Math.PI / 2;

export interface Crowd {
  /** Grundstimmung 0..1 */
  excite: number;
  /** Welle läuft durch die Ränge */
  wave(): void;
  /** Arme nach vorn: Abstimmung (0..1) */
  vote: number;
  update(dt: number): void;
  /** Weltposition des Kaisers (für die Kamera) */
  emperor: Vector3;
}

interface CrowdState {
  time: number;
  excite: number;
  wave: number;
  waveAng: number;
  vote: number;
}

/** Bewegt die Zuschauer im Vertex-Shader: Wippen, Arme hoch, Welle. Kostet fast nichts. */
class CrowdPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly st: CrowdState,
  ) {
    super(material, 'Crowd', 200, { CROWD: false });
    this._enable(true);
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['CROWD'] = true;
  }

  override getClassName(): string {
    return 'CrowdPlugin';
  }

  override getAttributes(attributes: string[]): void {
    attributes.push('crowd');
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'crowdTime', size: 1, type: 'float' },
        { name: 'crowdExcite', size: 1, type: 'float' },
        { name: 'crowdWave', size: 1, type: 'float' },
        { name: 'crowdWaveAng', size: 1, type: 'float' },
        { name: 'crowdVote', size: 1, type: 'float' },
      ],
      vertex: 'uniform float crowdTime; uniform float crowdExcite; uniform float crowdWave; uniform float crowdWaveAng; uniform float crowdVote;',
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    ubo.updateFloat('crowdTime', this.st.time);
    ubo.updateFloat('crowdExcite', this.st.excite);
    ubo.updateFloat('crowdWave', this.st.wave);
    ubo.updateFloat('crowdWaveAng', this.st.waveAng);
    ubo.updateFloat('crowdVote', this.st.vote);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: 'attribute vec4 crowd;',
      CUSTOM_VERTEX_UPDATE_POSITION: `
        float cph = fract(sin(dot(world3.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float cang = atan(world3.z, world3.x);
        float cdw = cang - crowdWaveAng;
        cdw -= 6.2831853 * floor((cdw + 3.14159265) / 6.2831853);
        float cex = clamp(crowdExcite + crowdWave * exp(-cdw * cdw * 14.0), 0.0, 1.0);
        float cact = step(cph, 0.12 + cex * 0.88);
        float cbeat = max(0.0, sin(crowdTime * (6.0 + cph * 4.0) + cph * 40.0));
        if (color.g > 0.5) {
          vec3 csh = vec3(sign(positionUpdated.x) * 0.215, 0.6, 0.04);
          float cwave = 0.5 + 0.5 * sin(crowdTime * (6.0 + cph * 5.0) + cph * 17.0);
          float ca = 0.6 + cact * cex * (1.5 + 0.9 * cwave);
          ca = mix(ca, 1.7, crowdVote * step(cph, 0.85));
          vec3 cd = positionUpdated - csh;
          float cc = cos(ca);
          float cs = sin(ca);
          positionUpdated = csh + vec3(cd.x, cd.y * cc + cd.z * cs, -cd.y * cs + cd.z * cc);
          normalUpdated = vec3(normalUpdated.x, normalUpdated.y * cc + normalUpdated.z * cs, -normalUpdated.y * cs + normalUpdated.z * cc);
        }
        if (positionUpdated.y > 0.05) {
          positionUpdated.y += cact * cex * (0.02 + 0.09 * cbeat) + 0.01 * sin(crowdTime * 1.3 + cph * 20.0);
          positionUpdated.z += 0.03 * sin(crowdTime * 0.7 + cph * 31.0) * positionUpdated.y;
        }
      `,
      CUSTOM_VERTEX_MAIN_END: `
        vec3 cskin = mix(vec3(0.36, 0.2, 0.12), vec3(0.72, 0.5, 0.36), crowd.a);
        vec3 chair = mix(vec3(0.03, 0.025, 0.02), vec3(0.22, 0.13, 0.06), fract(cph * 7.3));
        vec3 ccol = color.r < 0.25 ? crowd.rgb : (color.r < 0.75 ? chair : cskin);
        vColor = vec4(ccol * color.b, 1.0);
      `,
    };
  }
}

/* ---------- Figur ---------- */

function paint(m: Mesh, part: number, arm: boolean, shade: number, hairFn?: (x: number, y: number, z: number) => boolean): void {
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const col: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const hair = hairFn?.(pos[i], pos[i + 1], pos[i + 2]) ?? false;
    col.push(hair ? 0.5 : part, arm ? 1 : 0, shade, 1);
  }
  m.setVerticesData(VertexBuffer.ColorKind, col);
}

/** Sitzende Figur, Blick nach +Z, Sitzfläche bei y = 0, Füße auf der Stufe darunter */
function buildFigure(scene: Scene): Mesh {
  const parts: Mesh[] = [];
  const add = (m: Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    m.bakeCurrentTransformIntoVertices();
    parts.push(m);
    return m;
  };
  const CLOTH = 0;
  const SKIN = 1;
  const thighs = add(MeshBuilder.CreateBox('t', { width: 0.38, height: 0.15, depth: 0.46 }, scene), 0, 0.1, 0.18);
  paint(thighs, CLOTH, false, 0.85);
  const shins = add(MeshBuilder.CreateBox('s', { width: 0.3, height: 0.52, depth: 0.12 }, scene), 0, -0.2, 0.42);
  paint(shins, SKIN, false, 0.7);
  const torso = MeshBuilder.CreateCylinder('b', { height: 0.5, diameterTop: 0.34, diameterBottom: 0.44, tessellation: 8 }, scene);
  torso.scaling.z = 0.62;
  add(torso, 0, 0.42, -0.02);
  paint(torso, CLOTH, false, 1);
  const neck = add(MeshBuilder.CreateCylinder('n', { height: 0.1, diameter: 0.1, tessellation: 6 }, scene), 0, 0.71, 0);
  paint(neck, SKIN, false, 0.8);
  const head = add(MeshBuilder.CreateSphere('h', { diameter: 0.22, segments: 4 }, scene), 0, 0.85, 0.01);
  paint(head, SKIN, false, 1, (_x, y, z) => y > 0.88 || (z < -0.02 && y > 0.79));
  for (const sx of [-1, 1]) {
    const arm = add(MeshBuilder.CreateBox('a', { width: 0.09, height: 0.5, depth: 0.1 }, scene), sx * 0.215, 0.36, 0.04);
    paint(arm, SKIN, true, 0.9);
  }
  const fig = Mesh.MergeMeshes(parts, true, true) as Mesh;
  fig.name = 'spectator';
  return fig;
}

const TOGAS: [number, number, number][] = [
  [0.72, 0.68, 0.6], // ungefärbte Wolle
  [0.62, 0.57, 0.48],
  [0.8, 0.77, 0.7], // weiße Toga
  [0.45, 0.07, 0.05], // rot
  [0.55, 0.32, 0.1], // ocker
  [0.2, 0.26, 0.38], // blaugrau
  [0.32, 0.36, 0.18], // oliv
  [0.38, 0.22, 0.14], // braun
  [0.5, 0.15, 0.25], // weinrot
];

export function buildCrowd(scene: Scene, env: Environment, q: QualityProfile, stands: Stands): Crowd {
  const st: CrowdState = { time: 0, excite: 0.2, wave: 0, waveAng: 0, vote: 0 };
  const fill = { ultra: 0.95, high: 0.85, medium: 0.7, low: 0.45 }[q.tier];
  const fig = buildFigure(scene);
  const mat = new PBRMaterial('crowdMat', scene);
  mat.albedoColor = Color3.White();
  mat.metallic = 0;
  mat.roughness = 0.92;
  mat.environmentIntensity = 0;
  mat.maxSimultaneousLights = 2;
  const animated = !scene.getEngine().isWebGPU;
  if (animated) new CrowdPlugin(mat, st);
  fig.material = mat;
  fig.receiveShadows = q.tier !== 'low';
  fig.isPickable = false;
  fig.alwaysSelectAsActiveMesh = true;

  const mats: number[] = [];
  const data: number[] = [];
  const m = new Matrix();
  const place = (x: number, y: number, z: number, yaw: number, s: number, rgb: [number, number, number], skin: number) => {
    Matrix.ComposeToRef(new Vector3(s, s, s), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(x, y, z), m);
    for (let k = 0; k < 16; k++) mats.push(m.m[k]);
    data.push(rgb[0], rgb[1], rgb[2], skin);
  };
  const rnd = mulberry(7);
  const box0 = { a: PULVINAR_ANGLE, half: 0.16 };
  for (let i = 0; i < stands.steps; i++) {
    const rIn = stands.r0 + i * stands.depth;
    const rc = rIn + 0.5;
    const y = stands.y0 + (i + 1) * stands.rise;
    const n = Math.floor((Math.PI * 2 * rc) / 0.6);
    for (let j = 0; j < n; j++) {
      const a = ((j + (i % 2) * 0.5) / n) * Math.PI * 2 + (rnd() - 0.5) * 0.012;
      let da = a - box0.a;
      da -= Math.PI * 2 * Math.floor((da + Math.PI) / (Math.PI * 2));
      if (Math.abs(da) < box0.half && i >= 1) continue;
      if (rnd() > fill) continue;
      const yaw = Math.atan2(-Math.cos(a), -Math.sin(a)) + (rnd() - 0.5) * 0.5;
      const t = TOGAS[Math.floor(rnd() * TOGAS.length)];
      const v = 0.85 + rnd() * 0.3;
      place(Math.cos(a) * rc, y, Math.sin(a) * rc, yaw, 0.9 + rnd() * 0.18, [t[0] * v, t[1] * v, t[2] * v], rnd());
    }
  }

  /* ---------- Kaiserloge (Pulvinar) ---------- */
  const pa = PULVINAR_ANGLE;
  const radial = new Vector3(Math.cos(pa), 0, Math.sin(pa));
  const tangent = new Vector3(-Math.sin(pa), 0, Math.cos(pa));
  const yawIn = Math.atan2(-radial.x, -radial.z);
  const baseR = stands.r0 + stands.depth * 1;
  const floorY = stands.y0 + stands.rise * 6;
  const ROT = Math.atan2(-Math.cos(pa), -Math.sin(pa));
  const gBox = new GeoBuilder();
  const gCloth = new GeoBuilder();
  // Boden der Loge: Block von der zweiten Stufe bis nach hinten
  const at = (along: number, out: number) => radial.scale(baseR + out).add(tangent.scale(along));
  const bc = at(0, 2.0);
  box(gBox, bc.x, (stands.y0 + floorY) / 2, bc.z, 5.6, floorY - stands.y0, 4.0, 1.2, ROT);
  // Brüstung vorn
  const pf = at(0, 0.15);
  box(gBox, pf.x, floorY + 0.5, pf.z, 5.6, 1.0, 0.25, 1.2, ROT);
  // Säulen
  for (const s of [-2.6, 2.6]) {
    for (const o of [0.2, 3.7]) {
      const c = at(s, o);
      box(gBox, c.x, floorY + 1.9, c.z, 0.32, 3.8, 0.32, 1.2, ROT);
    }
  }
  // Dachbalken
  const roofC = at(0, 1.95);
  box(gBox, roofC.x, floorY + 3.9, roofC.z, 5.9, 0.3, 4.0, 1.2, ROT);
  const boxMesh = gBox.build('pulvinar', scene);
  const mp = new PBRMaterial('pulvinarMat', scene);
  const pm = plasterMaps(scene);
  mp.albedoTexture = pm.albedo;
  mp.bumpTexture = pm.normal;
  mp.albedoColor = new Color3(1, 0.95, 0.88);
  mp.roughness = 0.75;
  mp.metallic = 0;
  mp.environmentIntensity = 0;
  boxMesh.material = mp;
  boxMesh.receiveShadows = true;
  env.addCaster(boxMesh);
  // Purpurnes Tuch über der Loge und an der Brüstung
  const cc = at(0, 1.95);
  box(gCloth, cc.x, floorY + 4.1, cc.z, 6.0, 0.08, 4.2, 1, ROT);
  const dr = at(0, 0.02);
  box(gCloth, dr.x, floorY + 0.55, dr.z, 5.2, 0.8, 0.04, 1, ROT);
  const cloth = gCloth.build('pulvinarCloth', scene);
  const purple = clothMaps(scene, [92, 18, 60]);
  const mc = new PBRMaterial('purple', scene);
  mc.albedoTexture = purple.albedo;
  mc.bumpTexture = purple.normal;
  mc.roughness = 0.9;
  mc.metallic = 0;
  mc.environmentIntensity = 0;
  cloth.material = mc;
  cloth.receiveShadows = true;
  env.addCaster(cloth);
  // Kaiser, Gefolge, Wachen
  const seat = at(0, 1.1);
  const emperor = new Vector3(seat.x, floorY + 0.9, seat.z);
  place(seat.x, floorY + 0.45, seat.z, yawIn, 1.08, [0.3, 0.04, 0.2], 0.75);
  for (const s of [-1.5, 1.5]) {
    const p = at(s, 1.3);
    place(p.x, floorY + 0.45, p.z, yawIn + s * 0.1, 1.0, [0.82, 0.8, 0.74], 0.7);
  }
  for (const s of [-2.2, 2.2]) {
    const p = at(s, 2.9);
    place(p.x, floorY + 0.45, p.z, yawIn, 1.0, [0.5, 0.08, 0.06], 0.5);
  }

  fig.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true);
  fig.thinInstanceSetBuffer('crowd', new Float32Array(data), 4, true);
  if (!animated) {
    // WebGPU: Farbe über Instanzfarbe, ohne Bewegung
    const cols: number[] = [];
    for (let i = 0; i < data.length; i += 4) cols.push(data[i], data[i + 1], data[i + 2], 1);
    fig.removeVerticesData(VertexBuffer.ColorKind);
    fig.thinInstanceSetBuffer('color', new Float32Array(cols), 4, true);
  }

  let waveT = 0;
  const crowd: Crowd = {
    excite: 0.2,
    vote: 0,
    emperor,
    wave() {
      waveT = 6;
      st.waveAng = Math.random() * Math.PI * 2;
    },
    update(dt: number) {
      st.time += dt;
      st.excite += (crowd.excite - st.excite) * Math.min(1, dt * 3);
      st.vote += (crowd.vote - st.vote) * Math.min(1, dt * 4);
      if (waveT > 0) {
        waveT -= dt;
        st.wave = Math.min(1, waveT) * 0.9;
        st.waveAng += dt * 1.4;
      } else st.wave = 0;
    },
  };
  return crowd;
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
