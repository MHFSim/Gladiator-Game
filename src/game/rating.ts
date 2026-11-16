/**
 * Hausrangliste mit Glicko-2 (Mark Glickman, 2012): Wertung, Unsicherheit und Schwankung.
 * Jedes Handy führt seine eigene Liste der Gegner, gegen die es gekämpft hat.
 */

export interface Rating {
  r: number;
  rd: number;
  vol: number;
}

export interface Rival {
  name: string;
  r: number;
  rd: number;
  w: number;
  l: number;
  last: number;
}

export const START_RATING: Rating = { r: 1500, rd: 350, vol: 0.06 };
const TAU = 0.5;
const SCALE = 173.7178;

/** Neue Wertung nach einem Kampf (score 1 = Sieg, 0 = Niederlage) */
export function glicko2(me: Rating, opp: { r: number; rd: number }, score: number): Rating {
  const mu = (me.r - 1500) / SCALE;
  const phi = me.rd / SCALE;
  const muJ = (opp.r - 1500) / SCALE;
  const phiJ = opp.rd / SCALE;
  const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
  const E = 1 / (1 + Math.exp(-g * (mu - muJ)));
  const v = 1 / (g * g * E * (1 - E));
  const delta = v * g * (score - E);
  // Neue Schwankung (Illinois-Verfahren)
  const a = Math.log(me.vol * me.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 50) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 60 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * g * (score - E);
  return { r: muNew * SCALE + 1500, rd: Math.min(350, Math.max(30, phiNew * SCALE)), vol };
}

/** Aktuelle Saison: Vierteljahr, z. B. „2026-IV“ */
export function seasonOf(t = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${['I', 'II', 'III', 'IV'][Math.floor(d.getMonth() / 3)]}`;
}

/** Saisonwechsel: Wertung halb zur Mitte, Unsicherheit wieder höher */
export function seasonReset(r: Rating): Rating {
  return { r: Math.round(1500 + (r.r - 1500) * 0.5), rd: Math.max(r.rd, 200), vol: 0.06 };
}

/** Rangtitel nach Wertung */
export function rankTitle(r: number): string {
  if (r >= 2000) return 'Primus Palus';
  if (r >= 1800) return 'Champion';
  if (r >= 1650) return 'Veteran';
  if (r >= 1500) return 'Gladiator';
  if (r >= 1350) return 'Tiro';
  return 'Novicius';
}
