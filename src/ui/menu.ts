import QRCode from 'qrcode';
import type { Game } from '../game/game';
import { localTransport, newRoomCode, normalizeCode, trysteroTransport, type Transport } from '../net/transport';
import { VENATIO_WAVES, assignTeams, isTeamMode, MODE_NAMES, MODE_SIZE, TEAM_COLORS, type FighterSetup, type MatchMode, type MatchSetup } from '../game/match';
import { MAX_ITEMS, AI_LEVELS, AI_NAMES, aiAttrs, balanced, derive, equippedOf, heroKit, heroStats, winReward, type Attrs, type Hero } from '../game/hero';
import { CLASS_ORDER, CLASSES, type ClassId } from '../data/classes';
import { aiEquipment, applyItemStats, kitFor, RARITY, rollLoot, tiersOf, validItem, winDenare, type Equipped, type Item } from '../game/items';
import type { Settings } from '../core/settings';
import { saveSettings } from '../core/settings';
import { HeroScreen } from './heroScreen';
import { Results, type ResultExtra } from './results';
import type { WeatherKind } from '../render/weather';
import type { ArenaKind } from '../arena/capua';

const PROTOCOL = 4;

/** Namen für KI-Gladiatoren im Gruppenkampf */
const GLADIATOR_NAMES = ['Spiculus', 'Priscus', 'Verus', 'Flamma', 'Carpophorus', 'Tetraites', 'Crixus', 'Oenomaus', 'Gannicus', 'Celadus', 'Triumphus', 'Columbus', 'Petraites', 'Hermes', 'Asteropaeus', 'Calamus'];

/** Acht Teilnehmer: der eigene Held und sieben KI-Gladiatoren um die gewählte Stufe */
function newTourney(i: number): Tourney {
  const names = shuffle(GLADIATOR_NAMES);
  const base = AI_LEVELS[i];
  const entrants: Entrant[] = [{ name: 'Du', cls: 'murmillo', eq: {}, level: 1 }];
  for (let k = 1; k < 8; k++) {
    const level = Math.max(1, Math.min(50, base + Math.round((Math.random() - 0.35) * 4)));
    entrants.push({ name: names[k], cls: randomClass(), eq: aiEquipment(level), level });
  }
  return { lvl: i, round: 0, entrants, alive: [0, 1, 2, 3, 4, 5, 6, 7] };
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function randomClass(): ClassId {
  return CLASS_ORDER[Math.floor(Math.random() * CLASS_ORDER.length)];
}

/** KI-Kämpfer mit Stufe, zufälliger Klasse und passender Ausrüstung */
function aiSetup(levelIdx: number, team: number, name: string): FighterSetup {
  const lvl = AI_LEVELS[levelIdx];
  const cls = randomClass();
  const eq = aiEquipment(lvl);
  return {
    cls,
    kit: kitFor(cls, eq),
    tiers: tiersOf(eq),
    stats: applyItemStats(derive(aiAttrs(lvl)), eq),
    info: { name, level: lvl },
    team,
    owner: 'ai',
    ai: levelIdx,
  };
}
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
  cls: ClassId;
  items: Item[];
  rating?: { r: number; rd: number };
}

type TrainMode = MatchMode | 'tourney';

const TOURNEY_NAMES = ['Rekruten', 'Tirones', 'Veteranen', 'Champions', 'Primi Pali'];
const ROUND_NAMES = ['Viertelfinale', 'Halbfinale', 'Finale'];

interface Entrant {
  name: string;
  cls: ClassId;
  eq: Equipped;
  level: number;
}

interface Tourney {
  lvl: number;
  round: number;
  entrants: Entrant[];
  /** Noch im Turnier (Index 0 = eigener Held), Paarungen 0-1, 2-3, … */
  alive: number[];
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
    this.heroScreen = new HeroScreen(hero, () => this.show('menu-main'), () => this.applyHeroLook());
    this.results = new Results(() => this.hero, {
      again: () => this.game.rematch(),
      hero: () => this.reopen('menu-hero'),
      home: () => this.reopen('menu-main'),
      leave: () => (location.href = location.origin + location.pathname),
    });
    game.onMatchEnd = (r) => this.results.show(r, this.game.role, this.tourney && this.game.role === 'solo' ? this.tourneyExtra(r.won) : undefined);
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
    for (const id of ['train-life', 'host-life']) {
      const cb = $<HTMLInputElement>(id);
      cb.checked = settings.life;
      cb.onchange = () => {
        this.settings.life = cb.checked;
        saveSettings(this.settings);
        $<HTMLInputElement>('train-life').checked = cb.checked;
        $<HTMLInputElement>('host-life').checked = cb.checked;
      };
    }
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

  current: Screen = 'menu-main';

  private show(id: Screen): void {
    this.current = id;
    for (const k of ['menu-main', 'menu-host', 'menu-join', 'menu-train', 'menu-hero']) $(k).hidden = k !== id;
    $('menu').classList.toggle('sub', id === 'menu-hero' || id === 'menu-train' || id === 'menu-host');
    $('menu').classList.toggle('hero-bg', id === 'menu-hero');
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
    return {
      name: this.hero.name,
      level: this.hero.level,
      attrs: { ...this.hero.attrs },
      cls: this.hero.cls,
      items: Object.values(equippedOf(this.hero)) as Item[],
      rating: { r: Math.round(this.hero.rating.r), rd: Math.round(this.hero.rating.rd) },
    };
  }

  /** Aussehen des eigenen Gladiators sofort anpassen (Heldenmenü) */
  private applyHeroLook(): void {
    if (this.game.role !== 'solo') return;
    this.game.setClass(this.game.player, this.hero.cls, heroKit(this.hero), tiersOf(equippedOf(this.hero)));
    this.game.player.stats = heroStats(this.hero);
  }

  /** Klassen der Trainingsgegner (pro Besuch neu gewürfelt) */
  private trainClasses: ClassId[] = AI_LEVELS.map(() => randomClass());
  private trainEq: Equipped[] = AI_LEVELS.map((l) => aiEquipment(l));
  private trainMode: TrainMode = (localStorage.getItem('seg-mode') as TrainMode) || 'duel';
  private tourney: Tourney | null = null;

  /** Eigener Held als Kämpfer im Plan */
  private heroSetup(team: number, owner: string): FighterSetup {
    const eq = equippedOf(this.hero);
    return {
      cls: this.hero.cls,
      kit: heroKit(this.hero),
      tiers: tiersOf(eq),
      stats: heroStats(this.hero),
      info: { name: this.hero.name, level: this.hero.level, rating: Math.round(this.hero.rating.r), rd: Math.round(this.hero.rating.rd) },
      team,
      owner,
    };
  }

  /** Stufe der KI-Verbündeten: passend zum eigenen Helden */
  private allyLevel(max: number): number {
    let j = 0;
    AI_LEVELS.forEach((l, i) => {
      if (l <= this.hero.level) j = i;
    });
    return Math.min(j, max);
  }

  /** Trainingsplan: Duell gegen den gewählten Gegner oder Gruppenkampf mit KI-Füllung */
  private trainSetup(i: number, mode: MatchMode): MatchSetup {
    if (mode === 'duel') {
      const fc = this.trainClasses[i];
      const feq = this.trainEq[i];
      const lvl = AI_LEVELS[i];
      return {
        mode,
        life: this.settings.life,
        fighters: [
          this.heroSetup(0, 'local'),
          {
            cls: fc,
            kit: kitFor(fc, feq),
            tiers: tiersOf(feq),
            stats: applyItemStats(derive(aiAttrs(lvl)), feq),
            info: { name: `${AI_NAMES[i]} (${CLASSES[fc].name})`, level: lvl },
            team: 1,
            owner: 'ai',
            ai: i,
          },
        ],
      };
    }
    const names = shuffle(GLADIATOR_NAMES);
    const ally = this.allyLevel(i);
    if (mode === 'venatio') {
      // Mit einem KI-Gefährten gegen die Bestien
      return { mode, life: true, level: i, fighters: [this.heroSetup(0, 'local'), aiSetup(ally, 0, names[0])] };
    }
    const teams = assignTeams(mode, 1);
    const fighters: FighterSetup[] = [this.heroSetup(teams[0], 'local')];
    for (let k = 1; k < teams.length; k++) {
      const friend = isTeamMode(mode) && teams[k] === teams[0];
      fighters.push(aiSetup(friend ? ally : i, teams[k], names[k % names.length]));
    }
    return { mode, fighters, life: this.settings.life };
  }

  /** Eigene Werte und KI-Gegner fürs Training setzen */
  private applySolo(i: number, mode: MatchMode = 'duel'): void {
    this.game.startSolo(this.trainSetup(i, mode));
  }

  private markMode(): void {
    $('train-mode').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.trainMode));
    $('train-info').textContent =
      this.trainMode === 'tourney'
        ? `Turnier: acht Gladiatoren, drei Duelle bis zum Sieg. Wer verliert, scheidet aus. Turniersiege bisher: ${this.hero.tourneys}`
        : this.trainMode === 'venatio'
          ? `Venatio: mit einem Gefährten gegen ${VENATIO_WAVES} Wellen aus Wölfen und Stieren. Beste Welle bisher: ${this.hero.venatio}. Stärke der Bestien:`
          : this.trainMode === 'duel'
        ? 'Wähle deinen Gegner. Erfahrung gibt es nur für einen Sieg (2 Runden gewinnen).'
        : isTeamMode(this.trainMode)
          ? `${MODE_NAMES[this.trainMode]}: KI-Gefährten an deiner Seite. Sieg, wenn das gegnerische Team fällt. Stufe der Gegner:`
          : `${MODE_NAMES[this.trainMode]}: jeder gegen jeden, nur einer verlässt die Arena. Stufe der Gegner:`;
  }

  private showTrain(): void {
    const list = $('train-list');
    list.innerHTML = '';
    this.trainClasses = AI_LEVELS.map(() => randomClass());
    this.trainEq = AI_LEVELS.map((l) => aiEquipment(l));
    $('train-mode').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        this.trainMode = b.dataset.mode as TrainMode;
        localStorage.setItem('seg-mode', this.trainMode);
        this.showTrain();
      };
    });
    this.markMode();
    const mode = this.trainMode;
    AI_LEVELS.forEach((lvl, i) => {
      const b = document.createElement('button');
      const xp = winReward(this.hero.level, lvl, 0, false, false).base;
      const who =
        mode === 'tourney'
          ? `Turnier der ${TOURNEY_NAMES[i]}`
          : mode === 'venatio'
            ? `Bestien: ${['zahm', 'hungrig', 'wild', 'rasend', 'Bestien des Kaisers'][i]}`
            : mode === 'duel'
              ? `${AI_NAMES[i]} · ${CLASSES[this.trainClasses[i]].name}`
              : `${AI_NAMES[i]}${isTeamMode(mode) ? 'e' : ''} · ${MODE_SIZE[mode] - (isTeamMode(mode) ? MODE_SIZE[mode] / 2 : 1)} Gegner`;
      const prize = mode === 'tourney' ? 'Turniersieg: seltene Beute oder besser, dreifache Denare' : `Sieg: ${xp}+ Erfahrung, ${winDenare(lvl, false)} Denare, Beute`;
      b.innerHTML = `${who} · Stufe ${lvl}<small>${prize}</small>`;
      b.onclick = async () => {
        this.settings.difficulty = i;
        saveSettings(this.settings);
        await this.world.setArena(this.settings.arena);
        if (mode === 'tourney') {
          this.tourney = newTourney(i);
          this.startTourneyMatch();
          this.close('solo');
          return;
        }
        this.tourney = null;
        this.applySolo(i, mode);
        const w = this.world.pick();
        this.world.apply(w.weather, w.time);
        this.close('solo');
      };
      list.appendChild(b);
    });
    this.show('menu-train');
  }

  /* ---------- Turnier ---------- */

  /** Duell der aktuellen Turnierrunde gegen den nächsten Gegner */
  private startTourneyMatch(): void {
    const t = this.tourney!;
    const o = t.entrants[t.alive[1]];
    const w = this.world.pick();
    this.world.apply(w.weather, w.time, false);
    this.game.startSolo({
      mode: 'duel',
      life: this.settings.life,
      fighters: [
        this.heroSetup(0, 'local'),
        {
          cls: o.cls,
          kit: kitFor(o.cls, o.eq),
          tiers: tiersOf(o.eq),
          stats: applyItemStats(derive(aiAttrs(o.level)), o.eq),
          info: { name: `${o.name} (${CLASSES[o.cls].name})`, level: o.level },
          team: 1,
          owner: 'ai',
          ai: Math.min(AI_LEVELS.length - 1, t.lvl + (t.round === 2 ? 1 : 0)),
        },
      ],
    });
    this.game.hudHint(`${ROUND_NAMES[t.round]}: ${o.name} (${CLASSES[o.cls].name}, Stufe ${o.level})`);
  }

  /** Nach einem Turnierduell: weiterkommen, ausscheiden oder gewinnen */
  private tourneyExtra(won: boolean): ResultExtra {
    const t = this.tourney!;
    const round = ROUND_NAMES[t.round];
    if (!won) {
      this.tourney = null;
      return { apply: () => `Ausgeschieden im ${round}.`, againLabel: 'Neues Turnier', onAgain: () => this.reopenTrain() };
    }
    // Die anderen Paarungen dieser Runde ausfechten (stärkere Kämpfer gewinnen öfter)
    const next: number[] = [0];
    for (let k = 2; k < t.alive.length; k += 2) {
      const a = t.entrants[t.alive[k]];
      const b = t.entrants[t.alive[k + 1]];
      next.push(Math.random() < a.level / (a.level + b.level + 0.01) + (Math.random() - 0.5) * 0.3 ? t.alive[k] : t.alive[k + 1]);
    }
    t.alive = next;
    t.round++;
    if (t.alive.length === 1) {
      this.tourney = null;
      return {
        apply: (h) => {
          h.tourneys++;
          const lvl = AI_LEVELS[t.lvl];
          const den = winDenare(lvl, false) * 3;
          h.denare += den;
          const loot = rollLoot(lvl + 6, true, Math.random, 2);
          if (h.items.length < MAX_ITEMS) h.items.push(loot);
          return `TURNIERSIEG! Der Lorbeerkranz gehört dir. +${den} Denare · Siegerpreis: <span style="color:${RARITY[loot.rarity].color}">${loot.name}</span>`;
        },
        againLabel: 'Neues Turnier',
        onAgain: () => this.reopenTrain(),
      };
    }
    const o = t.entrants[t.alive[1]];
    return {
      apply: () => `${round} gewonnen! Im ${ROUND_NAMES[t.round]} wartet ${o.name} (${CLASSES[o.cls].name}, Stufe ${o.level}).`,
      againLabel: `${ROUND_NAMES[t.round]} beginnen`,
      onAgain: () => this.startTourneyMatch(),
    };
  }

  private reopenTrain(): void {
    this.reopen('menu-train');
    this.showTrain();
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
    const url = this.link(code);
    QRCode.toCanvas($<HTMLCanvasElement>('qr'), url, { width: 150, margin: 1, color: { dark: '#1a0f0a', light: '#f3e9d8' } }).catch(() => undefined);
    $('m-share').onclick = async () => {
      const text = `Kämpf mit mir in der Arena von Sanguis et Gloria! Code: ${code}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Sanguis et Gloria', text, url });
        else {
          await navigator.clipboard.writeText(url);
          $('host-status').textContent = 'Link kopiert – schick ihn deinen Mitspielern.';
        }
      } catch {
        /* abgebrochen */
      }
    };
    const t = this.connect(code);
    this.transport = t;
    let started = false;
    /** Gäste in der Reihenfolge ihres Eintreffens */
    const guests = new Map<string, { nick: string; hero: HeroMsg }>();
    const modeSel = $<HTMLSelectElement>('host-match');
    const startBtn = $<HTMLButtonElement>('m-host-start');
    const aiIdx = this.allyLevel(AI_LEVELS.length - 1);

    const refresh = () => {
      if (started) return;
      const mode = modeSel.value as MatchMode;
      const size = MODE_SIZE[mode];
      const humans = [this.hero.name, ...[...guests.values()].map((g) => String(g.hero.name).slice(0, 18))];
      const teams = assignTeams(mode, Math.min(humans.length, size));
      const box = $('host-lobby');
      box.innerHTML = '';
      for (let i = 0; i < (mode === 'venatio' ? Math.min(size, humans.length) : size); i++) {
        const el = document.createElement('span');
        const human = i < humans.length;
        el.className = human ? '' : 'ai';
        const dot = document.createElement('i');
        dot.style.background = TEAM_COLORS[teams[i] % TEAM_COLORS.length].field;
        el.appendChild(dot);
        el.appendChild(document.createTextNode(human ? humans[i] : `KI (Stufe ${AI_LEVELS[aiIdx]})`));
        box.appendChild(el);
      }
      const extra = humans.length - size;
      startBtn.disabled = guests.size === 0;
      $('host-status').textContent =
        guests.size === 0
          ? 'Warte auf Mitspieler … freie Plätze füllt die KI.'
          : extra > 0
            ? `${extra} Spieler zu viel für ${MODE_NAMES[mode]} – wähle einen größeren Modus.`
            : `${guests.size} Mitspieler bereit. Freie Plätze übernimmt die KI.`;
      t.send('lobby', { names: humans, mode });
    };
    modeSel.onchange = refresh;
    refresh();

    t.onPeerJoin(() => t.send('hello', { v: PROTOCOL, role: 'host', hero: this.heroMsg() }));
    t.on('hello', (d, peer) => {
      const h = d as { v: number; role: string; hero?: HeroMsg; nick?: string };
      if (h.v !== PROTOCOL) {
        $('host-status').textContent = 'Verschiedene Spielversionen – bitte alle Seiten neu laden.';
        return;
      }
      if (h.role !== 'guest' || started || !h.hero || !h.nick) return;
      if (!guests.has(peer) && guests.size >= 7) return;
      guests.set(peer, { nick: String(h.nick), hero: h.hero });
      refresh();
    });

    startBtn.onclick = () => {
      if (started || guests.size === 0) return;
      const mode = modeSel.value as MatchMode;
      const size = MODE_SIZE[mode];
      const equal = $<HTMLSelectElement>('host-mode').value === 'equal';
      const chosen = [...guests.entries()].slice(0, size - 1);
      const teams = assignTeams(mode, chosen.length + 1);
      const names = shuffle(GLADIATOR_NAMES);
      const fromMsg = (m: HeroMsg, team: number, owner: string): FighterSetup => {
        const eq: Equipped = {};
        for (const it of Array.isArray(m.items) ? m.items.filter(validItem) : []) eq[it.slot] = it;
        const cls: ClassId = CLASS_ORDER.includes(m.cls) ? m.cls : 'murmillo';
        return {
          cls,
          kit: equal ? CLASSES[cls].kit : kitFor(cls, eq),
          tiers: tiersOf(eq),
          stats: equal ? derive(balanced(m.attrs)) : applyItemStats(derive(m.attrs), eq),
          info: {
            name: String(m.name).slice(0, 18),
            level: m.level,
            rating: Number.isFinite(m.rating?.r) ? Math.max(100, Math.min(3500, m.rating!.r)) : undefined,
            rd: Number.isFinite(m.rating?.rd) ? Math.max(30, Math.min(350, m.rating!.rd)) : undefined,
          },
          team,
          owner,
        };
      };
      const fighters: FighterSetup[] = [fromMsg(this.heroMsg(), teams[0], 'local')];
      chosen.forEach(([peer, g], k) => fighters.push(fromMsg(g.hero, teams[k + 1], peer)));
      if (mode !== 'venatio') for (let k = fighters.length; k < size; k++) fighters.push(aiSetup(aiIdx, teams[k], names[k % names.length]));
      const setup: MatchSetup = { mode, fighters, ...this.world.pick(), arena: this.settings.arena, life: mode === 'venatio' || this.settings.life, level: aiIdx };
      const nicks: Record<string, string> = {};
      for (const [peer, g] of chosen) nicks[peer] = g.nick;
      started = true;
      startBtn.disabled = true;
      $('host-status').textContent = 'Die Arena wird vorbereitet …';
      const waiting = new Set(chosen.map(([p]) => p));
      let go = false;
      const begin = () => {
        if (go) return;
        go = true;
        this.countdown('host-status', () => {
          t.send('start', { v: PROTOCOL });
          this.game.startNet('host', t, setup, 'local');
          this.close('host');
        });
      };
      t.on('ready', (_d, peer) => {
        waiting.delete(peer);
        if (waiting.size === 0) begin();
      });
      void this.world.setArena(setup.arena!).then(() => {
        this.world.apply(setup.weather as WeatherKind, setup.time ?? 14);
        t.send('prep', { v: PROTOCOL, setup, nicks });
        // Falls ein Gast nicht antwortet: trotzdem beginnen
        window.setTimeout(begin, 20000);
      });
    };

    t.onPeerLeave((peer) => {
      const g = guests.get(peer);
      if (started && !this.open) this.game.peerLeft(peer, g ? String(g.hero.name) : 'Ein Mitspieler');
      else if (!started) {
        guests.delete(peer);
        refresh();
      }
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
    const nick = Math.random().toString(36).slice(2, 10);
    let started = false;
    let hostPeer: string | null = null;
    const hello = () => t.send('hello', { v: PROTOCOL, role: 'guest', hero: this.heroMsg(), nick });
    const timeout = window.setTimeout(() => {
      if (!hostPeer) $('join-status').textContent = 'Noch keine Arena gefunden. Code richtig? Wartet der Gastgeber noch? Tipp: Klappt es im Mobilfunk nicht, alle ins selbe WLAN.';
    }, 20000);
    t.onPeerJoin(() => {
      if (!hostPeer) $('join-status').textContent = 'Verbinde …';
      hello();
    });
    t.on('hello', (d, peer) => {
      const h = d as { v: number; role: string };
      if (h.role !== 'host') return; // andere Gäste
      if (h.v !== PROTOCOL) {
        $('join-status').textContent = 'Verschiedene Spielversionen – bitte alle Seiten neu laden.';
        return;
      }
      if (hostPeer === null) $('join-status').textContent = 'Verbunden! Warte, bis der Gastgeber den Kampf beginnt …';
      hostPeer = peer;
      // Immer antworten: nach kurzer Funkstille meldet der Gastgeber uns neu an
      if (!setup) hello();
    });
    t.on('lobby', (d, peer) => {
      if (setup || (hostPeer && peer !== hostPeer)) return;
      const l = d as { names: string[]; mode: MatchMode };
      $('join-status').textContent = `${MODE_NAMES[l.mode] ?? 'Arena'} · In der Arena: ${l.names.map((n) => String(n).slice(0, 18)).join(', ')}. Warte auf den Start …`;
    });
    let setup: MatchSetup | null = null;
    let me: string | null = null;
    t.on('prep', async (d) => {
      if (setup) return;
      const m = d as { setup: MatchSetup; nicks: Record<string, string> };
      me = Object.keys(m.nicks ?? {}).find((k) => m.nicks[k] === nick) ?? null;
      if (!me) {
        $('join-status').textContent = 'Die Arena ist voll – der Kampf beginnt ohne dich.';
        return;
      }
      setup = m.setup;
      window.clearTimeout(timeout);
      $('join-status').textContent = 'Die Arena wird vorbereitet …';
      if (setup.arena) await this.world.setArena(setup.arena);
      if (setup.weather) this.world.apply(setup.weather as WeatherKind, setup.time ?? 14);
      $('join-status').textContent = 'Bereit – der Kampf beginnt gleich …';
      t.send('ready', { v: PROTOCOL });
    });
    t.on('start', () => {
      if (started || !setup || !me) return;
      started = true;
      this.game.startNet('guest', t, setup, me);
      this.close('guest');
    });
    t.onPeerLeave((peer) => {
      if (started && peer === hostPeer) this.game.endNet('Verbindung zum Gastgeber verloren');
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
