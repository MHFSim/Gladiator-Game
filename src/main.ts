import './style.css';
import { FreeCamera, Matrix, Scene, Vector3 } from '@babylonjs/core';
import { buildCapua } from './arena/capua';
import { createEngine } from './core/engine';
import { DynamicResolution, guessTier, PROFILES, TIER_ORDER } from './core/quality';
import { loadSettings } from './core/settings';
import { Game } from './game/game';
import { Gladiator, GladiatorAssets } from './gladiators/gladiator';
import { bindButtons, TouchInput } from './input/touch';
import { createEnvironment } from './render/environment';
import { Hud } from './ui/hud';

const params = new URLSearchParams(location.search);

function progress(p: number, label: string): void {
  (document.getElementById('loading-bar') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  (document.getElementById('loading-text') as HTMLElement).textContent = label;
}

async function boot(): Promise<void> {
  const settings = loadSettings();
  if (params.get('quality')) settings.quality = params.get('quality') as typeof settings.quality;
  if (params.get('scheme')) settings.scheme = params.get('scheme') as typeof settings.scheme;
  if (params.get('time')) settings.timeOfDay = parseFloat(params.get('time')!);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  progress(0.05, 'Starte Grafik …');
  const { engine, kind } = await createEngine(canvas, settings.renderer);
  let tier = guessTier(settings.quality);
  const profile = { ...PROFILES[tier] };
  if (params.get('scale')) profile.renderScale = parseFloat(params.get('scale')!);
  if (params.get('cascades')) profile.cascades = parseInt(params.get('cascades')!, 10);
  if (params.get('bloom')) profile.bloom = params.get('bloom') === '1';
  const maxScale = Math.min(profile.renderScale, window.devicePixelRatio || 1);
  engine.setHardwareScalingLevel(1 / maxScale);

  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  scene.autoClear = false;
  scene.autoClearDepthAndStencil = true;
  const camera = new FreeCamera('cam', new Vector3(0, 2.5, -11), scene);
  camera.fov = 0.95;
  camera.minZ = 0.1;
  camera.maxZ = 2500;
  camera.inputs.clear();

  progress(0.15, 'Baue den Himmel …');
  const env = createEnvironment(scene, camera, profile);
  env.setTime(settings.timeOfDay);
  progress(0.25, 'Baue den Ludus von Capua …');
  await new Promise((r) => setTimeout(r, 0));
  const arena = buildCapua(scene, env, profile);

  const assets = await GladiatorAssets.load(scene, progress);
  progress(0.8, 'Lege die Rüstung an …');
  const player = Gladiator.create(scene, env, assets, { field: '#8e1c16', emblem: '#e2b65a', plume: [170, 24, 20] });
  const dummy = Gladiator.create(scene, env, assets, { field: '#1d3f78', emblem: '#d9c27a', plume: [235, 230, 215] });

  const input = new TouchInput(
    canvas,
    document.getElementById('stick-base') as HTMLElement,
    document.getElementById('stick-knob') as HTMLElement,
    settings.scheme,
  );
  bindButtons(document.getElementById('buttons') as HTMLElement, input);

  let paused = false;
  let game: Game | null = null;
  const project = (w: Vector3) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const p = Vector3.Project(w, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(width, height));
    if (p.z < 0 || p.z > 1) return null;
    return { x: p.x, y: p.y };
  };
  const hud = new Hud(settings, {
    onDifficulty: (i) => game?.setDifficulty(i),
    project,
    onScheme: (s) => (input.scheme = s),
    onTime: (h) => env.setTime(h),
    onPause: (p) => (paused = p),
    rendererLabel: kind,
    tierLabel: tier,
  });
  hud.onCheer(() => input.push({ type: 'cheer' }));
  game = new Game(scene, camera, arena, player, dummy, input, hud, settings.difficulty);
  const g = game;

  progress(0.95, 'Die Tore öffnen sich …');
  await scene.whenReadyAsync();

  // Bildrate stabil halten
  const target = () => (settings.battery ? 30 : 60);
  const dyn = new DynamicResolution(maxScale, Math.max(0.75, maxScale * 0.55), target(), (s) => engine.setHardwareScalingLevel(1 / s));
  let lowStreak = 0;

  const view = params.get('view');
  let last = performance.now();
  let acc = 0;
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    if (settings.battery) {
      acc += dt;
      if (acc < 1 / 31) return;
    }
    last = now;
    const frameDt = settings.battery ? acc : dt;
    acc = 0;
    if (!paused) g.update(frameDt, env.daylight, params.has('freeze'));
    if (view === 'hero') g.debugCamera(new Vector3(1.6, 1.7, -3.9), new Vector3(0, 1.25, -6));
    if (view === 'arena') g.debugCamera(new Vector3(9, 6.5, -12), new Vector3(-2, 1.5, 2));
    if (view === 'front') g.debugCamera(new Vector3(0.4, 1.7, -3.6), new Vector3(0, 1.35, -6));
    if (view === 'face') g.debugCamera(new Vector3(0.15, 1.75, -4.9), new Vector3(0, 1.62, -6));
    if (view === 'up') g.debugCamera(new Vector3(0, 1.7, -8), new Vector3(-6, 9, 12));
    if (view === 'side') g.debugCamera(g.player.pos.add(new Vector3(-3.2, 1.5, 1.2)), g.player.pos.add(new Vector3(0, 1.0, 0)));
    if (view === 'duel') g.debugCamera(new Vector3(4.5, 2.2, -3), new Vector3(0, 1.2, -1.8));
    scene.render();
    const fps = dyn.update(frameDt);
    if (fps !== null) {
      hud.setFps(fps);
      // Dauerhaft zu langsam -> Stufe senken (wirkt nach Neustart)
      if (settings.quality === 'auto' && fps < target() * 0.7 && dyn.scale <= Math.max(0.75, maxScale * 0.55) + 0.01) {
        lowStreak++;
        if (lowStreak >= 3) {
          const i = TIER_ORDER.indexOf(tier);
          if (i > 0) {
            tier = TIER_ORDER[i - 1];
            try {
              localStorage.setItem('seg.autoTierCap', tier);
            } catch {
              /* egal */
            }
          }
          lowStreak = 0;
        }
      } else lowStreak = 0;
    }
  });

  window.addEventListener('resize', () => engine.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => engine.resize(), 300));
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    last = performance.now();
  });

  (document.getElementById('loading') as HTMLElement).style.display = 'none';
  (window as unknown as { __ready: boolean; __game: Game }).__ready = true;
  (window as unknown as { __game: Game; __input: TouchInput }).__game = g;
  (window as unknown as { __input: TouchInput }).__input = input;
}

boot().catch((e) => {
  console.error(e);
  progress(1, 'Fehler beim Laden: ' + (e instanceof Error ? e.message : String(e)));
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
