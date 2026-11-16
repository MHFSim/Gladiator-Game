import {
  CascadedShadowGenerator,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  ColorCurves,
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
  /** 0 (Mittag) .. 1 (Abendrot) */
  sunWarmth: number;
  hours: number;
  setTime(hours: number): void;
  /** Wolkendecke 0..1, Dunstdichte, Dunstfarbe */
  setWeather(cover: number, fog: number, tint: Color3, gloom?: number): void;
  /** Blitz 0..1 */
  setFlash(f: number): void;
  /** Wolkendecke 0..1 (für Lichtstrahlen, Staub) */
  cover: number;
  /** Kinomoment 0..1: Farben ausbleichen */
  setCinematic(c: number): void;
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
  skyMat.mieCoefficient = 0.0032;
  skyMat.mieDirectionalG = 0.86;
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

  let cover = 0.12;
  let fogBase = 0.0028;
  let fogTint = new Color3(1, 0.95, 0.85);
  let baseHemi = 0.6;
  let gloom = 0;
  let baseExposure = 1;
  let cine = 0;
  // Farbstimmung wie im Kino: warme Lichter, kühle Schatten, abends goldener
  const curves = new ColorCurves();
  pipeline.imageProcessing.colorCurves = curves;
  pipeline.imageProcessing.colorCurvesEnabled = true;
  const grade = () => {
    const w = env.sunWarmth;
    const d = env.daylight;
    curves.globalSaturation = 6 - 45 * gloom - 40 * cine;
    curves.globalExposure = 0;
    curves.highlightsHue = 36;
    curves.highlightsDensity = (16 + 26 * w) * (1 - gloom);
    curves.highlightsSaturation = 8;
    curves.midtonesHue = 28;
    curves.midtonesDensity = (5 + 12 * w) * (1 - gloom);
    curves.shadowsHue = d < 0.3 ? 225 : 200;
    curves.shadowsDensity = 20 + 14 * w + (1 - d) * 15;
    curves.shadowsSaturation = 0;
    curves.shadowsExposure = -6 * cine;
  };
  const env: Environment = {
    sun,
    hemi,
    shadows,
    probe,
    pipeline,
    daylight: 1,
    sunWarmth: 0,
    hours: 14,
    cover: 0.12,
    setCinematic(c: number) {
      if (Math.abs(c - cine) < 0.01) return;
      cine = c;
      grade();
    },
    setWeather(c: number, fog: number, tint: Color3, g = 0) {
      cover = c;
      env.cover = c;
      gloom = g;
      fogBase = fog;
      fogTint = tint;
      env.setTime(env.hours);
    },
    setFlash(f: number) {
      hemi.intensity = baseHemi + f * 4;
      pipeline.imageProcessing.exposure = baseExposure + f * 0.8;
    },
    setTime(hours: number) {
      env.hours = hours;
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
      env.sunWarmth = warm;
      sun.diffuse = lerpColor(new Color3(1.0, 0.97, 0.9), new Color3(1.0, 0.55, 0.28), warm);
      // Nachts übernimmt der Mond: kühles, schwaches Licht
      const night = 1 - Math.min(1, day / 0.25);
      sun.diffuse = lerpColor(sun.diffuse, new Color3(0.55, 0.66, 1.0), night);
      sun.specular = sun.diffuse;
      const overcast = Math.max(0, cover - 0.15) / 0.85;
      sun.intensity = (0.15 + 0.45 * night + 3.4 * Math.pow(day, 0.8)) * (1 - 0.85 * overcast);
      shadows.setDarkness(Math.min(0.85, overcast * 0.95));
      hemi.diffuse = lerpColor(new Color3(0.62, 0.72, 0.95), new Color3(0.75, 0.55, 0.5), warm);
      hemi.groundColor = lerpColor(new Color3(0.55, 0.45, 0.33), new Color3(0.35, 0.22, 0.15), warm);
      hemi.intensity = (0.2 + 0.15 * (1 - Math.min(1, day / 0.25)) + 0.67 * day) * (1 + 0.45 * overcast) * (1 - gloom);
      hemi.diffuse = lerpColor(hemi.diffuse, new Color3(0.72, 0.74, 0.78), overcast);
      hemi.diffuse = lerpColor(hemi.diffuse, new Color3(0.4, 0.48, 0.72), night);
      hemi.groundColor = lerpColor(hemi.groundColor, new Color3(0.3, 0.18, 0.1), night);
      baseHemi = hemi.intensity;
      skyMat.luminance = 1.0;
      skyMat.turbidity = 6 + warm * 4;

      // Nebelfarbe passend zum Horizont
      const fogDay = new Color3(0.78, 0.74, 0.66);
      const fogDusk = new Color3(0.62, 0.42, 0.32);
      const fogNight = new Color3(0.06, 0.06, 0.09);
      const fc = day > 0.25 ? lerpColor(fogDusk, fogDay, (day - 0.25) / 0.75) : lerpColor(fogNight, fogDusk, day / 0.25);
      scene.fogColor = lerpColor(fc, new Color3(fogTint.r * (0.15 + 0.7 * day), fogTint.g * (0.15 + 0.7 * day), fogTint.b * (0.17 + 0.7 * day)), overcast * 0.9 + (fogBase > 0.02 ? 0.1 : 0));
      // Luftperspektive: bei klarem Wetter etwas mehr Dunst, damit die Ränge in der Tiefe weicher werden
      scene.fogDensity = fogBase < 0.02 ? fogBase * 2.6 + 0.002 : fogBase;
      pipeline.imageProcessing.exposure = 1.0 + (1 - day) * 0.6 + overcast * 0.12 - gloom * 0.15;
      grade();
      baseExposure = pipeline.imageProcessing.exposure;
      probe.cubeTexture.resetRefreshCounter();
    },
    addCaster(mesh: Mesh) {
      shadows.addShadowCaster(mesh, true);
    },
  };
  return env;
}
