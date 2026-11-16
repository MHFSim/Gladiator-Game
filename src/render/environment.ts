import {
  CascadedShadowGenerator,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  ReflectionProbe,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  Vector3,
  type Camera,
} from '@babylonjs/core';
import { SkyMaterial } from '@babylonjs/materials/sky';
import type { QualityProfile } from '../core/quality';

export interface Environment {
  sun: DirectionalLight;
  hemi: HemisphericLight;
  shadows: ShadowGenerator;
  probe: ReflectionProbe;
  pipeline: DefaultRenderingPipeline;
  /** 0 (Nacht) .. 1 (Mittag) – für Fackeln, Staub usw. */
  daylight: number;
  setTime(hours: number): void;
  addCaster(mesh: Mesh): void;
}

function lerpColor(a: Color3, b: Color3, t: number): Color3 {
  return Color3.Lerp(a, b, Math.min(1, Math.max(0, t)));
}

export function createEnvironment(scene: Scene, camera: Camera, q: QualityProfile): Environment {
  scene.clearColor = new Color4(0.05, 0.04, 0.04, 1);
  scene.ambientColor = new Color3(0, 0, 0);

  // Himmel (physikalisches Preetham-Modell)
  const skyMat = new SkyMaterial('skyMat', scene);
  skyMat.backFaceCulling = false;
  skyMat.useSunPosition = true;
  skyMat.turbidity = 4;
  skyMat.rayleigh = 2.0;
  skyMat.mieCoefficient = 0.005;
  skyMat.mieDirectionalG = 0.8;
  skyMat.rawHdrOutput = true;
  skyMat.luminance = 1.0;
  const sky = MeshBuilder.CreateBox('sky', { size: 1800 }, scene);
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.applyFog = false;
  sky.isPickable = false;

  // Sonne
  const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.3), scene);
  sun.position = new Vector3(40, 60, -30);
  sun.intensity = 3;

  // Himmelslicht + Sand-Rückstrahlung
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;

  // Schatten
  let shadows: ShadowGenerator;
  if (q.cascades >= 2) {
    const csm = new CascadedShadowGenerator(q.shadowMapSize, sun);
    csm.numCascades = q.cascades;
    csm.lambda = 0.85;
    csm.shadowMaxZ = 70;
    csm.stabilizeCascades = true;
    csm.usePercentageCloserFiltering = true;
    csm.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    csm.bias = 0.004;
    csm.normalBias = 0.02;
    csm.darkness = 0.0;
    csm.depthClamp = true;
    shadows = csm;
  } else {
    const sg = new ShadowGenerator(q.shadowMapSize, sun);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = ShadowGenerator.QUALITY_LOW;
    sg.bias = 0.002;
    sg.normalBias = 0.02;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 160;
    shadows = sg;
  }

  // Reflexionen für Metall: Himmel in eine Würfeltextur rendern
  const probe = new ReflectionProbe('probe', 128, scene, true, false);
  probe.renderList?.push(sky);
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  probe.position = new Vector3(0, 2, 0);

  // Dunst
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0028;

  // Nachbearbeitung
  const pipeline = new DefaultRenderingPipeline('post', true, scene, [camera]);
  pipeline.samples = 1;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 1.05;
  pipeline.imageProcessing.contrast = 1.12;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 1.1;
  pipeline.imageProcessing.vignetteColor = new Color4(0.12, 0.04, 0.02, 0);
  pipeline.bloomEnabled = q.bloom;
  pipeline.bloomThreshold = 0.85;
  pipeline.bloomWeight = 0.28;
  pipeline.bloomKernel = 48;
  pipeline.bloomScale = 0.5;
  pipeline.grainEnabled = q.grain;
  pipeline.grain.intensity = 6;
  pipeline.grain.animated = true;
  pipeline.sharpenEnabled = q.tier === 'ultra' || q.tier === 'high';
  pipeline.sharpen.edgeAmount = 0.25;

  const env: Environment = {
    sun,
    hemi,
    shadows,
    probe,
    pipeline,
    daylight: 1,
    setTime(hours: number) {
      // Sonnenbahn: Aufgang 6 Uhr im Osten (+X), Untergang 20 Uhr im Westen, Mittag im Süden (-Z)
      const t = (hours - 6) / 14; // 0..1
      const elev = Math.sin(Math.PI * Math.min(1.05, Math.max(-0.05, t))) * (62 * Math.PI) / 180;
      const azim = Math.PI * t; // 0 = Osten, PI = Westen
      const dir = new Vector3(Math.cos(azim) * Math.cos(elev), Math.sin(elev), -Math.sin(azim) * Math.cos(elev) * 0.85 - 0.3);
      dir.normalize();
      sun.direction = dir.scale(-1);
      sun.position = dir.scale(80);
      skyMat.sunPosition = dir.scale(100);

      const e = Math.max(0, Math.sin(elev)); // 0..~0.88
      const day = Math.min(1, e / 0.35);
      env.daylight = day;
      const warm = 1 - Math.min(1, e / 0.45);
      sun.diffuse = lerpColor(new Color3(1.0, 0.97, 0.9), new Color3(1.0, 0.55, 0.28), warm);
      sun.specular = sun.diffuse;
      sun.intensity = 0.15 + 3.4 * Math.pow(day, 0.8);
      hemi.diffuse = lerpColor(new Color3(0.62, 0.72, 0.95), new Color3(0.75, 0.55, 0.5), warm);
      hemi.groundColor = lerpColor(new Color3(0.55, 0.45, 0.33), new Color3(0.35, 0.22, 0.15), warm);
      hemi.intensity = 0.2 + 0.67 * day;
      skyMat.luminance = 1.0;
      skyMat.turbidity = 6 + warm * 4;

      // Nebelfarbe passend zum Horizont
      const fogDay = new Color3(0.78, 0.74, 0.66);
      const fogDusk = new Color3(0.62, 0.42, 0.32);
      const fogNight = new Color3(0.06, 0.06, 0.09);
      const fc = day > 0.25 ? lerpColor(fogDusk, fogDay, (day - 0.25) / 0.75) : lerpColor(fogNight, fogDusk, day / 0.25);
      scene.fogColor = fc;
      pipeline.imageProcessing.exposure = 1.0 + (1 - day) * 0.35;
      probe.cubeTexture.resetRefreshCounter();
    },
    addCaster(mesh: Mesh) {
      shadows.addShadowCaster(mesh, true);
    },
  };
  return env;
}
