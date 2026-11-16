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
import { CLASS_ORDER, CLASSES } from '../data/classes';
import {
  AFFIX_NAMES,
  dismantleValue,
  mainText,
  MAX_PLUS,
  RARITY,
  SLOT_NAMES,
  SLOTS,
  upgradeChance,
  upgradeCost,
  type Item,
  type Slot,
} from '../game/items';

function itemHtml(it: Item): string {
  const aff = it.affixes.map((a) => AFFIX_NAMES[a.k](a.v)).join(' · ');
  return `<span style="color:${RARITY[it.rarity].color}">${it.name}${it.plus ? ' +' + it.plus : ''}</span><small>${mainText(it)}${aff ? ' · ' + aff : ''}</small>`;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Heldenkarte im Hauptmenü und der Bildschirm zum Verteilen der Punkte */
export class HeroScreen {
  private pending: Attrs = zeroAttrs();
  private rows = new Map<AttrKey, { val: HTMLElement; desc: HTMLElement; minus: HTMLButtonElement; plus: HTMLButtonElement }>();

  private tab: 'attrs' | 'class' | 'gear' | 'smith' = 'attrs';
  private selSlot: Slot = 'weapon';

  constructor(
    private hero: Hero,
    private readonly onBack: () => void,
    private readonly onChange: (h: Hero) => void,
  ) {
    document.querySelectorAll<HTMLButtonElement>('.hs-tabs button').forEach((b) => {
      b.onclick = () => this.setTab(b.dataset.tab as HeroScreen['tab']);
    });
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
      this.onChange(this.hero);
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
      this.onChange(this.hero);
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
    this.onChange(this.hero);
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

  private setTab(t: HeroScreen['tab']): void {
    this.tab = t;
    document.querySelectorAll<HTMLButtonElement>('.hs-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    for (const k of ['attrs', 'class', 'gear', 'smith']) $('hs-p-' + k).hidden = k !== t;
    this.msg('');
    this.render();
  }

  private save(): void {
    saveHero(this.hero);
    this.onChange(this.hero);
    this.render();
  }

  private renderClasses(): void {
    const grid = $('hs-classes');
    grid.innerHTML = '';
    for (const id of CLASS_ORDER) {
      const c = CLASSES[id];
      const b = document.createElement('button');
      b.className = id === this.hero.cls ? 'on' : '';
      b.innerHTML = `${c.name}<small>${c.role}</small>`;
      b.onclick = () => {
        this.hero.cls = id;
        this.save();
      };
      grid.appendChild(b);
    }
    const c = CLASSES[this.hero.cls];
    $('hs-class-desc').innerHTML = `<b>${c.name}</b> – ${c.desc}<br><b>${c.special.name}</b> (alle ${c.special.cooldown} s): ${c.special.desc}`;
  }

  private renderGear(): void {
    const h = this.hero;
    const slots = $('hs-slots');
    slots.innerHTML = '';
    for (const s of SLOTS) {
      const id = h.equipped[s];
      const it = h.items.find((i) => i.id === id);
      const row = document.createElement('div');
      row.className = 'slot-row' + (s === this.selSlot ? ' sel' : '');
      const name = s === 'shield' && h.cls === 'retiarius' ? 'Schulterschutz' : SLOT_NAMES[s];
      row.innerHTML = `<div><span class="slot-name">${name}</span><br>${it ? itemHtml(it) : '<small>leer</small>'}</div><button class="mini">Wechseln</button>`;
      row.onclick = () => {
        this.selSlot = s;
        this.render();
      };
      slots.appendChild(row);
    }
    const inv = $('hs-inv');
    inv.innerHTML = '';
    const list = h.items.filter((i) => i.slot === this.selSlot && i.id !== h.equipped[this.selSlot]);
    list.sort((a, b) => b.rarity - a.rarity || b.plus - a.plus);
    if (!list.length) inv.innerHTML = `<div class="hc-small">Keine weiteren Teile für „${SLOT_NAMES[this.selSlot]}“. Siege bringen Beute.</div>`;
    for (const it of list) {
      const row = document.createElement('div');
      row.className = 'inv-row';
      row.innerHTML = `<div>${itemHtml(it)}</div><div class="btns"><button class="mini">Anlegen</button></div>`;
      row.querySelector('button')!.onclick = () => {
        h.equipped[it.slot] = it.id;
        this.save();
        this.msg(`${it.name} angelegt.`);
      };
      inv.appendChild(row);
    }
  }

  private renderSmith(): void {
    const h = this.hero;
    const box = $('hs-smith');
    box.innerHTML = '';
    const eqIds = new Set(Object.values(h.equipped));
    const list = [...h.items].sort((a, b) => Number(eqIds.has(b.id)) - Number(eqIds.has(a.id)) || b.rarity - a.rarity || b.plus - a.plus);
    for (const it of list) {
      const row = document.createElement('div');
      row.className = 'inv-row';
      const worn = eqIds.has(it.id);
      const cost = upgradeCost(it);
      const can = it.plus < MAX_PLUS;
      row.innerHTML = `<div>${itemHtml(it)}${worn ? '<small>angelegt</small>' : ''}</div><div class="btns">${
        can ? `<button class="mini up">+1 · ${cost} D${upgradeChance(it) < 100 ? ` · ${upgradeChance(it)} %` : ''}</button>` : '<small>max.</small>'
      }${worn ? '' : `<button class="mini ghost del">Zerlegen +${dismantleValue(it)}</button>`}</div>`;
      const up = row.querySelector<HTMLButtonElement>('.up');
      if (up) {
        up.disabled = h.denare < cost;
        up.onclick = () => {
          if (h.denare < cost) return;
          h.denare -= cost;
          if (Math.random() * 100 < upgradeChance(it)) {
            it.plus++;
            this.msg(`Gelungen! ${it.name} +${it.plus}.`);
          } else this.msg('Der Schmied hat versagt – die Denare sind weg.');
          this.save();
        };
      }
      const del = row.querySelector<HTMLButtonElement>('.del');
      if (del) {
        del.onclick = () => {
          h.denare += dismantleValue(it);
          h.items = h.items.filter((x) => x !== it);
          this.msg(`${it.name} zerlegt.`);
          this.save();
        };
      }
      box.appendChild(row);
    }
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
    $('hs-record').textContent = `${CLASSES[h.cls].name} · Siege ${h.wins} · Niederlagen ${h.losses}`;
    $('hs-denare').textContent = `${h.denare} Denare`;
    if (this.tab === 'class') this.renderClasses();
    if (this.tab === 'gear') this.renderGear();
    if (this.tab === 'smith') this.renderSmith();
    this.refreshCard();
  }

  /** Karte im Hauptmenü */
  refreshCard(): void {
    const h = this.hero;
    $('hc-name').textContent = h.name;
    $('hc-level').textContent = `${CLASSES[h.cls].name} · Stufe ${h.level}`;
    const need = xpForNext(h.level);
    $('hc-xp').style.width = `${Math.min(100, (100 * h.xp) / need)}%`;
    $('hc-xp-text').textContent = `${h.xp} / ${need} Erfahrung`;
    const free = pointsFree(h);
    $('hc-points').textContent = free > 0 ? `${free} ${free === 1 ? 'Punkt' : 'Punkte'} zu verteilen ›` : '';
  }
}
