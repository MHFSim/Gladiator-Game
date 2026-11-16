import {
  ATTR_INFO,
  ATTRS,
  describe,
  exportHero,
  importHero,
  MAX_LEVEL,
  pointsFree,
  saveHero,
  xpForNext,
  zeroAttrs,
  type AttrKey,
  type Attrs,
  type Hero,
} from '../game/hero';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Heldenkarte im Hauptmenü und der Bildschirm zum Verteilen der Punkte */
export class HeroScreen {
  private pending: Attrs = zeroAttrs();
  private rows = new Map<AttrKey, { val: HTMLElement; desc: HTMLElement; minus: HTMLButtonElement; plus: HTMLButtonElement }>();

  constructor(
    private hero: Hero,
    private readonly onBack: () => void,
  ) {
    const list = $('hs-attrs');
    for (const k of ATTRS) {
      const info = ATTR_INFO[k];
      const row = document.createElement('div');
      row.className = 'attr-row';
      row.innerHTML = `<div class="attr-name">${info.latin} <span class="hc-small">· ${info.name}</span><small></small></div><div class="attr-val"></div><button aria-label="${info.name} weniger">−</button><button aria-label="${info.name} mehr">+</button>`;
      const [minus, plus] = Array.from(row.querySelectorAll('button'));
      minus.onclick = () => this.change(k, -1);
      plus.onclick = () => this.change(k, 1);
      list.appendChild(row);
      this.rows.set(k, { val: row.querySelector('.attr-val')!, desc: row.querySelector('small')!, minus, plus });
    }
    const name = $<HTMLInputElement>('hs-name');
    name.addEventListener('change', () => {
      const n = name.value.trim().slice(0, 18);
      if (n) this.hero.name = n;
      name.value = this.hero.name;
      saveHero(this.hero);
      this.refreshCard();
    });
    $('hs-apply').onclick = () => this.apply();
    $('hs-back').onclick = () => {
      this.pending = zeroAttrs();
      this.onBack();
    };
    $('hs-respec').onclick = () => {
      if (!confirm('Alle Attributpunkte zurücknehmen und neu verteilen?')) return;
      this.hero.attrs = zeroAttrs();
      this.pending = zeroAttrs();
      saveHero(this.hero);
      this.render();
      this.msg('Alle Punkte sind wieder frei.');
    };
    $('hs-export').onclick = () => this.exportFile();
    $('hs-import').onclick = () => $<HTMLInputElement>('hs-file').click();
    $<HTMLInputElement>('hs-file').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      (e.target as HTMLInputElement).value = '';
      if (!f) return;
      const r = importHero(await f.text());
      if (typeof r === 'string') return this.msg(r);
      if (!confirm(`${r.name} (Stufe ${r.level}) laden? Der jetzige Gladiator wird ersetzt.`)) return;
      Object.assign(this.hero, r);
      saveHero(this.hero);
      this.pending = zeroAttrs();
      this.render();
      this.msg(`${r.name} ist zurück im Ludus.`);
    });
    this.refreshCard();
  }

  get current(): Hero {
    return this.hero;
  }

  private msg(t: string): void {
    $('hs-msg').textContent = t;
  }

  private free(): number {
    return pointsFree(this.hero) - ATTRS.reduce((s, k) => s + this.pending[k], 0);
  }

  private change(k: AttrKey, d: number): void {
    if (d > 0 && this.free() <= 0) return this.msg('Keine freien Punkte. Neue gibt es mit jeder Stufe – also mit Siegen.');
    if (d < 0 && this.pending[k] <= 0) return;
    this.pending[k] += d;
    this.msg('');
    this.render();
  }

  private apply(): void {
    const n = ATTRS.reduce((s, k) => s + this.pending[k], 0);
    if (n === 0) return this.msg('Nichts zu übernehmen.');
    for (const k of ATTRS) this.hero.attrs[k] += this.pending[k];
    this.pending = zeroAttrs();
    saveHero(this.hero);
    this.render();
    this.msg(`${n} ${n === 1 ? 'Punkt' : 'Punkte'} verteilt. Gespeichert.`);
  }

  private exportFile(): void {
    const text = exportHero(this.hero);
    const file = new File([text], `${this.hero.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}-stufe${this.hero.level}.json`, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      nav.share({ files: [file], title: 'Sanguis et Gloria – Gladiator' }).catch(() => undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.msg('Datei gespeichert.');
  }

  show(): void {
    this.pending = zeroAttrs();
    this.msg('');
    $<HTMLInputElement>('hs-name').value = this.hero.name;
    this.render();
  }

  render(): void {
    const h = this.hero;
    const preview: Attrs = { ...h.attrs };
    for (const k of ATTRS) preview[k] += this.pending[k];
    const free = this.free();
    for (const k of ATTRS) {
      const r = this.rows.get(k)!;
      r.val.innerHTML = this.pending[k] > 0 ? `${preview[k]} <em>+${this.pending[k]}</em>` : String(preview[k]);
      r.desc.textContent = describe(k, preview);
      r.plus.disabled = free <= 0;
      r.minus.disabled = this.pending[k] <= 0;
    }
    const fe = $('hs-free');
    fe.textContent = free > 0 ? `${free} ${free === 1 ? 'Punkt' : 'Punkte'} frei` : 'keine Punkte frei';
    fe.classList.toggle('has', free > 0);
    $('hs-level').textContent = `Stufe ${h.level}${h.level >= MAX_LEVEL ? ' (Höchststufe)' : ''}`;
    const need = xpForNext(h.level);
    $('hs-xp').style.width = `${Math.min(100, (100 * h.xp) / need)}%`;
    $('hs-xp-text').textContent = h.level >= MAX_LEVEL ? 'Höchste Stufe erreicht' : `${h.xp} / ${need} Erfahrung bis Stufe ${h.level + 1}`;
    $('hs-record').textContent = `Siege ${h.wins} · Niederlagen ${h.losses}`;
    this.refreshCard();
  }

  /** Karte im Hauptmenü */
  refreshCard(): void {
    const h = this.hero;
    $('hc-name').textContent = h.name;
    $('hc-level').textContent = `Stufe ${h.level}`;
    const need = xpForNext(h.level);
    $('hc-xp').style.width = `${Math.min(100, (100 * h.xp) / need)}%`;
    $('hc-xp-text').textContent = `${h.xp} / ${need} Erfahrung`;
    const free = pointsFree(h);
    $('hc-points').textContent = free > 0 ? `${free} ${free === 1 ? 'Punkt' : 'Punkte'} zu verteilen ›` : '';
  }
}
