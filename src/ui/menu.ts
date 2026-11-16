import QRCode from 'qrcode';
import type { Game } from '../game/game';
import { localTransport, newRoomCode, normalizeCode, trysteroTransport, type Transport } from '../net/transport';
import type { NetSetup } from '../game/game';
import { AI_LEVELS, AI_NAMES, aiAttrs, balanced, derive, winReward, type Attrs, type Hero } from '../game/hero';
import type { Settings } from '../core/settings';
import { saveSettings } from '../core/settings';
import { HeroScreen } from './heroScreen';
import { Results } from './results';
import type { WeatherKind } from '../render/weather';
import type { ArenaKind } from '../arena/capua';

const PROTOCOL = 3;
type Screen = 'menu-main' | 'menu-host' | 'menu-join' | 'menu-train' | 'menu-hero';
export interface World {
  pick(): { weather: WeatherKind; time: number };
  apply(w: WeatherKind, time: number, announce?: boolean): void;
  arena(): ArenaKind;
  setArena(kind: ArenaKind): Promise<void>;
}
interface HeroMsg {
  name: string;
  level: number;
  attrs: Attrs;
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Hauptmenü: Training, Arena eröffnen (Gastgeber), Arena beitreten (Gast).
 */
export class Menu {
  open = true;
  private transport: Transport | null = null;
  private heroScreen: HeroScreen;
  readonly results: Results;

  constructor(
    private readonly game: Game,
    private readonly hero: Hero,
    private readonly settings: Settings,
    private readonly world: World,
    private readonly onStart: (mode: 'solo' | 'host' | 'guest') => void,
    private readonly netKind: 'webrtc' | 'local',
  ) {
    this.heroScreen = new HeroScreen(hero, () => this.show('menu-main'));
    this.results = new Results(() => this.hero, {
      again: () => this.game.rematch(),
      hero: () => this.reopen('menu-hero'),
      home: () => this.reopen('menu-main'),
      leave: () => (location.href = location.origin + location.pathname),
    });
    game.onMatchEnd = (r) => this.results.show(r, this.game.role);
    game.onRematch = () => this.results.hide();
    $('m-hero').onclick = () => this.show('menu-hero');
    $('m-train').onclick = () => this.showTrain();
    $('m-train-back').onclick = () => this.show('menu-main');
    for (const id of ['train-arena', 'host-arena']) {
      $(id).querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.onclick = () => {
          this.settings.arena = b.dataset.arena as ArenaKind;
          saveSettings(this.settings);
          this.markArena();
        };
      });
    }
    this.markArena();
    this.applySolo(settings.difficulty);
    $('m-host').onclick = () => this.host();
    $('m-join').onclick = () => this.showJoin();
    $('m-host-back').onclick = () => this.back();
    $('m-join-back').onclick = () => this.back();
    $('m-join-go').onclick = () => this.join(normalizeCode($<HTMLInputElement>('join-code').value));
    $<HTMLInputElement>('join-code').addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      el.value = normalizeCode(el.value);
    });
    $('menu').hidden = false;
    $('hud').hidden = true;
    // Einladungslink: direkt beitreten
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      this.showJoin();
      $<HTMLInputElement>('join-code').value = normalizeCode(room);
      this.join(normalizeCode(room));
    }
  }

  private show(id: Screen): void {
    for (const k of ['menu-main', 'menu-host', 'menu-join', 'menu-train', 'menu-hero']) $(k).hidden = k !== id;
    $('menu').classList.toggle('sub', id === 'menu-hero' || id === 'menu-train');
    if (id === 'menu-hero') this.heroScreen.show();
    if (id === 'menu-main') this.heroScreen.refreshCard();
  }

  private markArena(): void {
    document.querySelectorAll<HTMLButtonElement>('.arena-pick button').forEach((b) => b.classList.toggle('on', b.dataset.arena === this.settings.arena));
  }

  /** Zurück ins Menü (nach einem Trainingskampf) */
  reopen(id: Screen): void {
    this.open = true;
    $('menu').hidden = false;
    $('hud').hidden = true;
    this.show(id);
  }

  private heroMsg(): HeroMsg {
    return { name: this.hero.name, level: this.hero.level, attrs: { ...this.hero.attrs } };
  }

  /** Eigene Werte und KI-Gegner fürs Training setzen */
  private applySolo(i: number): void {
    const lvl = AI_LEVELS[i];
    this.game.setupSolo(derive(this.hero.attrs), { name: this.hero.name, level: this.hero.level }, derive(aiAttrs(lvl)), { name: AI_NAMES[i], level: lvl }, i);
  }

  private showTrain(): void {
    const list = $('train-list');
    list.innerHTML = '';
    AI_LEVELS.forEach((lvl, i) => {
      const b = document.createElement('button');
      const xp = winReward(this.hero.level, lvl, 0, false, false).base;
      b.innerHTML = `${AI_NAMES[i]} · Stufe ${lvl}<small>Sieg: ${xp} Erfahrung</small>`;
      b.onclick = async () => {
        this.settings.difficulty = i;
        saveSettings(this.settings);
        await this.world.setArena(this.settings.arena);
        this.applySolo(i);
        const w = this.world.pick();
        this.world.apply(w.weather, w.time);
        this.game.rematch();
        this.close('solo');
      };
      list.appendChild(b);
    });
    this.show('menu-train');
  }

  private back(): void {
    this.transport?.leave();
    this.transport = null;
    this.show('menu-main');
  }

  private close(mode: 'solo' | 'host' | 'guest'): void {
    $('menu').hidden = true;
    $('hud').hidden = false;
    this.open = false;
    this.onStart(mode);
  }

  private connect(code: string): Transport {
    return this.netKind === 'local' ? localTransport(code) : trysteroTransport(code);
  }

  private link(code: string): string {
    const base = location.origin + location.pathname;
    const extra = this.netKind === 'local' ? '&net=local' : '';
    return `${base}?room=${code}${extra}`;
  }

  /* ---------- Gastgeber ---------- */

  private host(): void {
    const code = newRoomCode();
    this.show('menu-host');
    $('host-code').textContent = code;
    $('host-status').textContent = 'Warte auf einen Gegner …';
    const url = this.link(code);
    QRCode.toCanvas($<HTMLCanvasElement>('qr'), url, { width: 150, margin: 1, color: { dark: '#1a0f0a', light: '#f3e9d8' } }).catch(() => undefined);
    $('m-share').onclick = async () => {
      const text = `Kämpf gegen mich in der Arena von Sanguis et Gloria! Code: ${code}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Sanguis et Gloria', text, url });
        else {
          await navigator.clipboard.writeText(url);
          $('host-status').textContent = 'Link kopiert – schick ihn deinem Gegner.';
        }
      } catch {
        /* abgebrochen */
      }
    };
    const t = this.connect(code);
    this.transport = t;
    let started = false;
    t.onPeerJoin(() => {
      $('host-status').textContent = 'Gegner gefunden, verbinde …';
      t.send('hello', { v: PROTOCOL, role: 'host', hero: this.heroMsg() });
    });
    t.on('hello', (d) => {
      const h = d as { v: number; role: string; hero?: HeroMsg };
      if (h.v !== PROTOCOL) {
        $('host-status').textContent = 'Verschiedene Spielversionen – bitte beide Seiten neu laden.';
        return;
      }
      if (h.role !== 'guest' || started || !h.hero) return;
      started = true;
      const guest = h.hero;
      const equal = $<HTMLSelectElement>('host-mode').value === 'equal';
      const me = this.heroMsg();
      const setup: NetSetup = {
        stats: [derive(equal ? balanced(me.attrs) : me.attrs), derive(equal ? balanced(guest.attrs) : guest.attrs)],
        info: [
          { name: me.name, level: me.level },
          { name: String(guest.name).slice(0, 18), level: guest.level },
        ],
        ...((): { weather: WeatherKind; time: number } => this.world.pick())(),
        arena: this.settings.arena,
      };
      $('host-status').textContent = `${setup.info[1].name} (Stufe ${guest.level}) ist da! Arena wird vorbereitet …`;
      let ready = false;
      const go = () => {
        if (ready) return;
        ready = true;
        this.countdown('host-status', () => {
          t.send('start', { v: PROTOCOL });
          this.game.startNet('host', t, setup);
          this.close('host');
        });
      };
      t.on('ready', go);
      void this.world.setArena(setup.arena!).then(() => {
        this.world.apply(setup.weather as WeatherKind, setup.time ?? 14);
        t.send('prep', { v: PROTOCOL, setup });
        // Falls der Gast nicht antwortet: trotzdem beginnen
        window.setTimeout(go, 20000);
      });
    });
    t.onPeerLeave(() => {
      if (started && !this.open) this.game.endNet('Der Gegner hat die Arena verlassen');
      else if (!started) $('host-status').textContent = 'Gegner wieder weg. Warte …';
    });
  }

  /* ---------- Gast ---------- */

  private showJoin(): void {
    this.show('menu-join');
    $('join-status').textContent = '';
    window.setTimeout(() => $<HTMLInputElement>('join-code').focus(), 50);
  }

  private join(code: string): void {
    if (code.length !== 6) {
      $('join-status').textContent = 'Der Code hat 6 Zeichen.';
      return;
    }
    this.transport?.leave();
    $('join-status').textContent = 'Suche die Arena …';
    const t = this.connect(code);
    this.transport = t;
    let started = false;
    const timeout = window.setTimeout(() => {
      if (!started) $('join-status').textContent = 'Noch keine Arena gefunden. Code richtig? Wartet der Gastgeber noch? Tipp: Klappt es im Mobilfunk nicht, beide ins selbe WLAN.';
    }, 20000);
    t.onPeerJoin(() => {
      $('join-status').textContent = 'Arena gefunden, verbinde …';
      t.send('hello', { v: PROTOCOL, role: 'guest', hero: this.heroMsg() });
    });
    t.on('hello', (d) => {
      const h = d as { v: number };
      if (h.v !== PROTOCOL) $('join-status').textContent = 'Verschiedene Spielversionen – bitte beide Seiten neu laden.';
      else $('join-status').textContent = 'Verbunden! Der Kampf beginnt …';
      // Antwort, falls unser erstes Hallo zu früh kam
      t.send('hello', { v: PROTOCOL, role: 'guest', hero: this.heroMsg() });
    });
    let setup: NetSetup | null = null;
    t.on('prep', async (d) => {
      if (setup) return;
      setup = (d as { setup: NetSetup }).setup;
      window.clearTimeout(timeout);
      $('join-status').textContent = 'Verbunden! Die Arena wird vorbereitet …';
      if (setup.arena) await this.world.setArena(setup.arena);
      if (setup.weather) this.world.apply(setup.weather as WeatherKind, setup.time ?? 14);
      $('join-status').textContent = 'Bereit – der Kampf beginnt gleich …';
      t.send('ready', { v: PROTOCOL });
    });
    t.on('start', () => {
      if (started || !setup) return;
      started = true;
      this.game.startNet('guest', t, setup);
      this.close('guest');
    });
    t.onPeerLeave(() => {
      if (started) this.game.endNet('Verbindung zum Gastgeber verloren');
    });
  }

  private countdown(statusId: string, done: () => void): void {
    let n = 3;
    const tick = () => {
      if (n === 0) return done();
      $(statusId).textContent = `Gegner verbunden! Kampf beginnt in ${n} …`;
      n--;
      window.setTimeout(tick, 1000);
    };
    tick();
  }
}
