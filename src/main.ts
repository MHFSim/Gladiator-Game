import './style.css';
import { FreeCamera, Logger, Matrix, Scene, Vector3 } from '@babylonjs/core';
import { buildArena } from './arena';
import type { ArenaKind } from './arena/capua';
import { createEngine } from './core/engine';
import { DynamicResolution, guessTier, PROFILES, TIER_ORDER } from './core/quality';
import { loadSettings, saveSettings } from './core/settings';
import { Game } from './game/game';
import { Gladiator, GladiatorAssets } from './gladiators/gladiator';
import { bindButtons, TouchInput } from './input/touch';
import { createEnvironment } from './render/environment';
import { Hud } from './ui/hud';
import { loadHero } from './game/hero';
import { Sound } from './audio/sound';
import { randomWeather, Weather, WEATHER_NAMES, type WeatherKind } from './render/weather';
import { Menu } from './ui/menu';

const params = new URLSearchParams(location.search);
const VERSION = __APP_VERSION__;

/* ---------- Ladeanzeige und Fehlerprotokoll (sichtbar auf dem Handy) ---------- */
let currentStep = '';
const errors: string[] = [];
function progress(p: number, label: string): void {
  currentStep = label;
  (document.getElementById('loading-bar') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  (document.getElementById('loading-text') as HTMLElement).textContent = label;
}
function reportError(msg: string): void {
  errors.push(msg);
  const box = document.getElementById('error-box') as HTMLElement;
  box.hidden = false;
  box.textContent = `Version ${VERSION} · Schritt: ${currentStep}\n` + errors.slice(-6).join('\n');
}
window.addEventListener('error', (e) => reportError('Fehler: ' + (e.message || String(e.error))));
window.addEventListener('unhandledrejection', (e) => reportError('Fehler: ' + String((e.reason && e.reason.message) || e.reason)));
Logger.OnNewCacheEntry = (entry: string) => {
  if (entry.includes('Error')) reportError(entry.replace(/<[^>]+>/g, '').slice(0, 300));
};
(document.getElementById('version') as HTMLElement).textContent = `v${VERSION}`;
// Ausweg, falls es hängt: niedrige Grafik und WebGL2 erzwingen
window.setTimeout(() => {
  const loading = document.getElementById('loading') as HTMLElement;
  if (loading.style.display === 'none') return;
  const b = document.getElementById('btn-safe') as HTMLButtonElement;
  b.hidden = false;
  b.onclick = () => {
    const s = loadSettings();
    s.quality = 'low';
    s.renderer = 'webgl2';
    saveSettings(s);
    location.reload();
  };
}, 20000);
// Wächter: hängt das Laden, zeigen wir an, wo
window.setTimeout(() => {
  const loading = document.getElementById('loading') as HTMLElement;
  if (loading.style.display !== 'none') reportError(`Laden dauert ungewöhnlich lange (über 45 s). Bitte Screenshot schicken.`);
}, 45000);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) =>
      window.setTimeout(() => {
        reportError(`Zeitüberschreitung: ${label} – fahre trotzdem fort`);
        resolve(null);
      }, ms),
    ),
  ]);
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
  if (params.get('arena')) settings.arena = params.get('arena') as ArenaKind;
  let built = buildArena(settings.arena, scene, env, profile);

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
  const sound = new Sound(settings.sound);
  const weather = new Weather(scene, env, camera, profile, sound);
  const RULE_TEXT: Record<WeatherKind, string> = {
    clear: 'Hitze: Ausdauer erholt sich langsamer',
    cloudy: 'Angenehmes Kampfwetter',
    rain: 'Nasser Sand: Ausweichen kostet mehr Ausdauer',
    storm: 'Nasser Sand: Ausweichen kostet mehr Ausdauer',
    fog: 'Nebel: Aufschalten erst aus kurzer Nähe',
  };
  const world = {
    pick(): { weather: WeatherKind; time: number } {
      const forced = params.get('weather') as WeatherKind | null;
      return { weather: forced ?? (settings.weather === 'random' ? randomWeather() : settings.weather), time: settings.timeOfDay };
    },
    apply(w: WeatherKind, time: number, announce = true): void {
      env.setTime(time);
      weather.set(w);
      game?.setWeatherRules(weather.rules);
      if (announce) window.setTimeout(() => hud.hint(`${WEATHER_NAMES[w]} – ${RULE_TEXT[w]}`, 3.5), 600);
    },
    arena(): ArenaKind {
      return built.arena.kind;
    },
    async setArena(kind: ArenaKind): Promise<void> {
      if (built.arena.kind === kind) return;
      const busy = document.getElementById('busy') as HTMLElement;
      (document.getElementById('busy-text') as HTMLElement).textContent = kind === 'colosseum' ? 'Das Kolosseum füllt sich …' : 'Zurück nach Capua …';
      busy.hidden = false;
      await new Promise((r) => setTimeout(r, 60));
      built.dispose();
      built = buildArena(kind, scene, env, profile);
      game?.setArena(built.arena);
      weather.set(weather.kind);
      game?.setWeatherRules(weather.rules);
      await withTimeout(scene.whenReadyAsync(), 10000, 'Arena vorbereiten').catch(() => undefined);
      busy.hidden = true;
    },
  };
  const hud = new Hud(settings, {
    onSound: (on) => sound.setEnabled(on),
    onGore: (lv) => game?.setGore(lv),
    onWeather: (w) => {
      if (game && game.role === 'solo') world.apply(w === 'random' ? randomWeather() : w, env.hours);
    },
    onAssist: (m) => {
      if (game) game.blockAssist = m;
    },
    project,
    onScheme: (s) => (input.scheme = s),
    onTime: (h) => env.setTime(h),
    onPause: (p) => (paused = p),
    rendererLabel: kind,
    tierLabel: tier,
  });
  hud.onCheer(() => input.push({ type: 'cheer' }));
  game = new Game(scene, camera, built.arena, player, dummy, input, hud, settings.difficulty, sound);
  const g = game;
  g.blockAssist = settings.blockAssist;
  g.setGore(settings.gore);
  world.apply(world.pick().weather, settings.timeOfDay, false);
  const hero = loadHero();
  let hinted = false;
  const menu = new Menu(g, hero, settings, world, (mode) => {
    if (mode === 'solo' && !hinted) hud.showControlsHint();
    hinted = true;
  }, params.get('net') === 'local' ? 'local' : 'webrtc');
  g.onNetEnd = (reason) => {
    hud.hint(reason, 3);
    window.setTimeout(() => (location.href = location.origin + location.pathname), 2500);
  };
  (document.getElementById('btn-menu') as HTMLElement).addEventListener('click', () => {
    location.href = location.origin + location.pathname;
  });
  let orbit = 0;

  progress(0.95, 'Die Tore öffnen sich …');
  // Nicht ewig auf Shader warten: nach 12 s trotzdem starten (fehlende Shader werden nachgeladen)
  await withTimeout(scene.whenReadyAsync(), 12000, 'Shader vorbereiten');

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
    if (!paused) g.update(frameDt, env.daylight, params.has('freeze') || menu.open);
    weather.update(frameDt);
    if (menu.open && !view) {
      orbit += frameDt * 0.08;
      if (menu.current === 'menu-hero') {
        // Im Heldenmenü: den eigenen Gladiator zeigen (rechts im Bild frei für die Liste)
        const p = g.player.pos;
        const a = Math.sin(orbit * 2) * 0.35;
        const fwd = new Vector3(Math.sin(g.player.g.heading), 0, Math.cos(g.player.g.heading));
        const right = new Vector3(fwd.z, 0, -fwd.x);
        const eye = p.add(fwd.scale(3.3 * Math.cos(a))).add(right.scale(3.3 * Math.sin(a) - 1.1)).add(new Vector3(0, 1.45, 0));
        g.debugCamera(eye, p.add(right.scale(-1.45)).add(new Vector3(0, 1.05, 0)));
      } else g.debugCamera(new Vector3(Math.sin(orbit) * 11, 4.2, Math.cos(orbit) * 11), new Vector3(0, 1.4, 0));
    }
    if (view === 'hero') g.debugCamera(g.player.pos.add(new Vector3(1.6, 1.7, 2.1)), g.player.pos.add(new Vector3(0, 1.25, 0)));
    if (view === 'arena') g.debugCamera(new Vector3(9, 6.5, -12), new Vector3(-2, 1.5, 2));
    if (view === 'front') g.debugCamera(g.player.pos.add(new Vector3(0.4, 1.7, 2.4)), g.player.pos.add(new Vector3(0, 1.35, 0)));
    if (view === 'face') g.debugCamera(g.player.pos.add(new Vector3(0.3, 1.55, 1.1)), g.player.pos.add(new Vector3(0, 1.5, 0.05)));
    if (view === 'up') g.debugCamera(new Vector3(0, 1.7, -8), new Vector3(-6, 9, 12));
    if (view === 'side') g.debugCamera(g.player.pos.add(new Vector3(-3.2, 1.5, 1.2)), g.player.pos.add(new Vector3(0, 1.0, 0)));
    if (view === 'high') g.debugCamera(new Vector3(-21, 15, -8), new Vector3(12, 9, 8));
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
  (window as unknown as { __world: typeof world }).__world = world;
  (window as unknown as { __input: TouchInput }).__input = input;
}

boot().catch((e) => {
  console.error(e);
  progress(1, 'Fehler beim Laden: ' + (e instanceof Error ? e.message : String(e)));
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
