/**
 * Der eigene Gladiator: Stufe, Erfahrung, Attribute. Erfahrung gibt es nur für Siege.
 * Gespeichert im Browser, exportierbar als Datei.
 */

export const ATTRS = ['vis', 'corpus', 'spiritus', 'celeritas', 'acies', 'gloria'] as const;
export type AttrKey = (typeof ATTRS)[number];
export type Attrs = Record<AttrKey, number>;

export const ATTR_INFO: Record<AttrKey, { latin: string; name: string; short: string }> = {
  vis: { latin: 'Vis', name: 'Stärke', short: 'Schwere Schläge, Schildstoß' },
  corpus: { latin: 'Corpus', name: 'Konstitution', short: 'Lebenspunkte' },
  spiritus: { latin: 'Spiritus', name: 'Kondition', short: 'Ausdauer und Erholung' },
  celeritas: { latin: 'Celeritas', name: 'Geschick', short: 'Angriffstempo, Ausweichen, Parade' },
  acies: { latin: 'Acies', name: 'Präzision', short: 'Kopftreffer, leichte Schläge' },
  gloria: { latin: 'Gloria', name: 'Showtalent', short: 'Gunst des Publikums' },
};

export const MAX_LEVEL = 50;
export const POINTS_PER_LEVEL = 3;
export const SOFT_CAP = 40;

export interface Hero {
  v: 1;
  name: string;
  level: number;
  xp: number; // Erfahrung innerhalb der aktuellen Stufe
  attrs: Attrs;
  wins: number;
  losses: number;
  created: number;
}

export interface Stats {
  hpMax: number;
  staminaMax: number;
  staminaRegen: number;
  lightMul: number;
  heavyMul: number;
  headMul: number;
  bashMul: number;
  windupMul: number;
  rollMul: number;
  moveMul: number;
  parryBonus: number;
  gloriaMul: number;
}

const KEY = 'seg.hero.v1';
const SALT = 'sanguis-et-gloria/ludus';

export const zeroAttrs = (): Attrs => ({ vis: 0, corpus: 0, spiritus: 0, celeritas: 0, acies: 0, gloria: 0 });

export function xpForNext(level: number): number {
  return Math.round(100 * Math.pow(level, 1.5));
}

export function pointsTotal(level: number): number {
  return POINTS_PER_LEVEL * (level - 1);
}

export function pointsSpent(a: Attrs): number {
  return ATTRS.reduce((s, k) => s + a[k], 0);
}

export function pointsFree(h: Hero): number {
  return pointsTotal(h.level) - pointsSpent(h.attrs);
}

/** Ab 40 Punkten wirkt jeder weitere Punkt nur noch halb */
export function eff(n: number): number {
  return n <= SOFT_CAP ? n : SOFT_CAP + (n - SOFT_CAP) / 2;
}

export function derive(a: Attrs): Stats {
  const v = eff(a.vis);
  const c = eff(a.corpus);
  const s = eff(a.spiritus);
  const g = eff(a.celeritas);
  const p = eff(a.acies);
  const gl = eff(a.gloria);
  return {
    hpMax: Math.round(100 + 1.5 * c),
    staminaMax: Math.round(100 + 1.0 * s),
    staminaRegen: 20 * (1 + 0.01 * s),
    lightMul: 1 + 0.004 * v + 0.006 * p,
    heavyMul: 1 + 0.012 * v,
    headMul: 1 + 0.015 * p,
    bashMul: 1 + 0.012 * v,
    windupMul: 1 / (1 + 0.006 * g),
    rollMul: 1 + 0.005 * g,
    moveMul: 1 + 0.002 * g,
    parryBonus: 0.0015 * g,
    gloriaMul: 1 + 0.02 * gl,
  };
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)} %`;

/** Wirkung eines Attributs in Klartext, mit aktuellem Wert */
export function describe(key: AttrKey, a: Attrs): string {
  const st = derive(a);
  switch (key) {
    case 'vis':
      return `Schwere Schläge ${pct(st.heavyMul - 1)}, Schildstoß ${pct(st.bashMul - 1)}`;
    case 'corpus':
      return `${st.hpMax} Lebenspunkte`;
    case 'spiritus':
      return `${st.staminaMax} Ausdauer, Erholung ${pct(st.staminaRegen / 20 - 1)}`;
    case 'celeritas':
      return `Ausholen ${pct(1 / st.windupMul - 1)} schneller, Paradefenster +${Math.round(st.parryBonus * 1000)} ms`;
    case 'acies':
      return `Kopftreffer ${pct(st.headMul - 1)}, leichte Schläge ${pct(st.lightMul - 1)}`;
    case 'gloria':
      return `Gunst ${pct(st.gloriaMul - 1)} (Publikum folgt in Phase 3)`;
  }
}

export function newHero(): Hero {
  return { v: 1, name: 'Spartacus', level: 1, xp: 0, attrs: zeroAttrs(), wins: 0, losses: 0, created: Date.now() };
}

function valid(h: unknown): h is Hero {
  if (!h || typeof h !== 'object') return false;
  const o = h as Hero;
  if (o.v !== 1 || typeof o.name !== 'string' || !Number.isInteger(o.level)) return false;
  if (o.level < 1 || o.level > MAX_LEVEL || !(o.xp >= 0)) return false;
  if (!o.attrs || ATTRS.some((k) => !Number.isInteger(o.attrs[k]) || o.attrs[k] < 0)) return false;
  return pointsSpent(o.attrs) <= pointsTotal(o.level);
}

export function loadHero(): Hero {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const h = JSON.parse(raw);
      if (valid(h)) return { ...newHero(), ...h };
    }
  } catch {
    /* neuer Held */
  }
  return newHero();
}

export function saveHero(h: Hero): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* Speicher voll oder privat */
  }
}

/** Einfache Prüfsumme gegen versehentlich (oder absichtlich) verbogene Spielstände */
function sign(text: string): string {
  let h = 0x811c9dc5;
  const s = SALT + text;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function exportHero(h: Hero): string {
  const data = JSON.stringify(h);
  return JSON.stringify({ spiel: 'Sanguis et Gloria', held: h, sig: sign(data) }, null, 1);
}

export function importHero(text: string): Hero | string {
  try {
    const o = JSON.parse(text) as { held?: unknown; sig?: string };
    if (!valid(o.held)) return 'Die Datei enthält keinen gültigen Gladiator.';
    if (o.sig !== sign(JSON.stringify(o.held))) return 'Die Datei wurde verändert und kann nicht geladen werden.';
    return { ...newHero(), ...o.held };
  } catch {
    return 'Die Datei konnte nicht gelesen werden.';
  }
}

export interface Reward {
  base: number;
  parries: number;
  flawless: number;
  total: number;
  levelsGained: number;
  pointsGained: number;
}

/** Erfahrung für einen Sieg. Stärkere Gegner geben mehr, schwächere weniger. */
export function winReward(me: number, foeLevel: number, parries: number, flawless: boolean, pvp: boolean): Omit<Reward, 'levelsGained' | 'pointsGained'> {
  const factor = Math.min(2, Math.max(0.3, 1 + (foeLevel - me) * 0.06));
  const base = Math.round((70 + 24 * foeLevel) * factor * (pvp ? 1.5 : 1));
  const par = Math.min(10, parries) * 6;
  const fl = flawless ? Math.round(base * 0.25) : 0;
  return { base, parries: par, flawless: fl, total: base + par + fl };
}

export function addXp(h: Hero, xp: number): { levelsGained: number } {
  let levels = 0;
  h.xp += xp;
  while (h.level < MAX_LEVEL && h.xp >= xpForNext(h.level)) {
    h.xp -= xpForNext(h.level);
    h.level++;
    levels++;
  }
  if (h.level >= MAX_LEVEL) h.xp = Math.min(h.xp, xpForNext(h.level));
  return { levelsGained: levels };
}

/* ---------- KI-Gegner ---------- */

export const AI_LEVELS = [1, 6, 14, 26, 40];
export const AI_NAMES = ['Rekrut', 'Tiro', 'Veteran', 'Champion', 'Primus Palus'];

/** KI-Gegner bekommen passend zur Stufe verteilte Punkte (ausgewogener Kämpfer) */
export function aiAttrs(level: number): Attrs {
  const a = zeroAttrs();
  const order: AttrKey[] = ['corpus', 'vis', 'spiritus', 'celeritas', 'acies', 'corpus', 'vis', 'spiritus', 'celeritas', 'gloria'];
  for (let i = 0; i < pointsTotal(level); i++) a[order[i % order.length]]++;
  return a;
}

/** Werte-Angleichung: Verteilung bleibt, Summe wird auf ein gemeinsames Niveau gebracht */
export function balanced(a: Attrs, total = 60): Attrs {
  const sum = pointsSpent(a);
  const out = zeroAttrs();
  if (sum === 0) {
    for (let i = 0; i < total; i++) out[ATTRS[i % 5]]++;
    return out;
  }
  let given = 0;
  for (const k of ATTRS) {
    out[k] = Math.floor((a[k] / sum) * total);
    given += out[k];
  }
  // Rest auf die größten Anteile
  const byShare = [...ATTRS].sort((x, y) => a[y] - a[x]);
  for (let i = 0; given < total; i++, given++) out[byShare[i % byShare.length]]++;
  return out;
}

export interface FighterInfo {
  name: string;
  level: number;
}
