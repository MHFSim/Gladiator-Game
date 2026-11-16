import { joinRoom } from 'trystero';

/** Gemeinsame Schnittstelle für die Verbindung zwischen zwei Spielern */
export interface Transport {
  send(ch: string, data: unknown): void;
  on(ch: string, fn: (data: unknown) => void): void;
  onPeerJoin(fn: () => void): void;
  onPeerLeave(fn: () => void): void;
  leave(): void;
  readonly kind: string;
}

export const CHANNELS = ['hello', 'prep', 'ready', 'start', 'in', 'act', 'snap', 'anim', 'ev'] as const;
const APP_ID = 'mhfsim.github.io/Gladiator-Game/v1';

/** Echte Verbindung übers Internet: WebRTC direkt zwischen den Handys, Vermittlung über öffentliche Nostr-Relays */
export function trysteroTransport(code: string): Transport {
  const room = joinRoom({ appId: APP_ID, maxUsers: 2, identity: 'none' } as Parameters<typeof joinRoom>[0], 'arena-' + code);
  const actions = new Map<string, { send: (d: unknown) => Promise<void>; onMessage: (h: (d: unknown) => void) => unknown }>();
  for (const ch of CHANNELS) {
    actions.set(ch, room.makeAction(ch) as unknown as { send: (d: unknown) => Promise<void>; onMessage: (h: (d: unknown) => void) => unknown });
  }
  return {
    kind: 'webrtc',
    send(ch, data) {
      actions.get(ch)?.send(data).catch(() => undefined);
    },
    on(ch, fn) {
      actions.get(ch)?.onMessage((d) => fn(d));
    },
    onPeerJoin(fn) {
      room.onPeerJoin(() => fn());
    },
    onPeerLeave(fn) {
      room.onPeerLeave(() => fn());
    },
    leave() {
      room.leave().catch(() => undefined);
    },
  };
}

/** Lokale Verbindung zwischen zwei Tabs desselben Browsers (nur zum Testen, ?net=local) */
export function localTransport(code: string): Transport {
  const bc = new BroadcastChannel('seg-' + code);
  const me = Math.random().toString(36).slice(2);
  const handlers = new Map<string, ((d: unknown) => void)[]>();
  const joins: (() => void)[] = [];
  const leaves: (() => void)[] = [];
  let peer: string | null = null;
  let lastSeen = 0;
  const post = (ch: string, data: unknown) => bc.postMessage({ from: me, ch, data });
  bc.onmessage = (e) => {
    const { from, ch, data } = e.data as { from: string; ch: string; data: unknown };
    if (from === me) return;
    lastSeen = performance.now();
    if (ch === '_presence') {
      if (peer !== from) {
        peer = from;
        post('_presence', null);
        joins.forEach((f) => f());
      }
      return;
    }
    if (ch === '_bye') {
      peer = null;
      leaves.forEach((f) => f());
      return;
    }
    for (const h of handlers.get(ch) ?? []) h(data);
  };
  const beat = window.setInterval(() => {
    post('_presence', null);
    if (peer && performance.now() - lastSeen > 4000) {
      peer = null;
      leaves.forEach((f) => f());
    }
  }, 1000);
  post('_presence', null);
  window.addEventListener('beforeunload', () => post('_bye', null));
  return {
    kind: 'local',
    send: post,
    on(ch, fn) {
      const list = handlers.get(ch) ?? [];
      list.push(fn);
      handlers.set(ch, list);
    },
    onPeerJoin(fn) {
      joins.push(fn);
    },
    onPeerLeave(fn) {
      leaves.push(fn);
    },
    leave() {
      post('_bye', null);
      window.clearInterval(beat);
      bc.close();
    },
  };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode(): string {
  let s = '';
  const r = crypto.getRandomValues(new Uint32Array(6));
  for (const v of r) s += ALPHABET[v % ALPHABET.length];
  return s;
}

export function normalizeCode(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}
