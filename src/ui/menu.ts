import QRCode from 'qrcode';
import type { Game } from '../game/game';
import { localTransport, newRoomCode, normalizeCode, trysteroTransport, type Transport } from '../net/transport';

const PROTOCOL = 1;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Hauptmenü: Training, Arena eröffnen (Gastgeber), Arena beitreten (Gast).
 */
export class Menu {
  open = true;
  private transport: Transport | null = null;

  constructor(
    private readonly game: Game,
    private readonly onStart: (mode: 'solo' | 'host' | 'guest') => void,
    private readonly netKind: 'webrtc' | 'local',
  ) {
    $('m-train').onclick = () => this.close('solo');
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
    // Einladungslink: direkt beitreten
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      this.showJoin();
      $<HTMLInputElement>('join-code').value = normalizeCode(room);
      this.join(normalizeCode(room));
    }
  }

  private show(id: 'menu-main' | 'menu-host' | 'menu-join'): void {
    for (const k of ['menu-main', 'menu-host', 'menu-join']) $(k).hidden = k !== id;
  }

  private back(): void {
    this.transport?.leave();
    this.transport = null;
    this.show('menu-main');
  }

  private close(mode: 'solo' | 'host' | 'guest'): void {
    $('menu').hidden = true;
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
      t.send('hello', { v: PROTOCOL, role: 'host' });
    });
    t.on('hello', (d) => {
      const h = d as { v: number; role: string };
      if (h.v !== PROTOCOL) {
        $('host-status').textContent = 'Verschiedene Spielversionen – bitte beide Seiten neu laden.';
        return;
      }
      if (h.role !== 'guest' || started) return;
      started = true;
      this.countdown('host-status', () => {
        t.send('start', { v: PROTOCOL });
        this.game.startNet('host', t);
        this.close('host');
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
      t.send('hello', { v: PROTOCOL, role: 'guest' });
    });
    t.on('hello', (d) => {
      const h = d as { v: number };
      if (h.v !== PROTOCOL) $('join-status').textContent = 'Verschiedene Spielversionen – bitte beide Seiten neu laden.';
      else $('join-status').textContent = 'Verbunden! Der Kampf beginnt …';
      // Antwort, falls unser erstes Hallo zu früh kam
      t.send('hello', { v: PROTOCOL, role: 'guest' });
    });
    t.on('start', () => {
      if (started) return;
      started = true;
      window.clearTimeout(timeout);
      this.game.startNet('guest', t);
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
