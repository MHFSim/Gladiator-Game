import { joinRoom } from 'trystero';

/** Gemeinsame Schnittstelle für die Verbindung zwischen mehreren Spielern (Gastgeber + bis zu 7 Gäste) */
export interface Transport {
  send(ch: string, data: unknown): void;
  on(ch: string, fn: (data: unknown, peer: string) => void): void;
  onPeerJoin(fn: (peer: string) => void): void;
  onPeerLeave(fn: (peer: string) => void): void;
  leave(): void;
  readonly kind: string;
}

export const CHANNELS = ['hello', 'lobby', 'prep', 'ready', 'start', 'in', 'act', 'snap', 'anim', 'ev'] as const;
const APP_ID = 'mhfsim.github.io/Gladiator-Game/v1';

/** Echte Verbindung übers Internet: WebRTC direkt zwischen den Handys, Vermittlung über öffentliche Nostr-Relays */
export function trysteroTransport(code: string): Transport {
  const room = joinRoom({ appId: APP_ID, maxUsers: 8, identity: 'none' } as Parameters<typeof joinRoom>[0], 'arena-' + code);
  type Act = { send: (d: unknown) => Promise<void>; onMessage: (h: (d: unknown, ctx: { peerId: string }) => void) => unknown };
  const actions = new Map<string, Act>();
  for (const ch of CHANNELS) {
    actions.set(ch, room.makeAction(ch) as unknown as Act);
  }
  return {
    kind: 'webrtc',
    send(ch, data) {
      actions.get(ch)?.send(data).catch(() => undefined);
    },
    on(ch, fn) {
      actions.get(ch)?.onMessage((d, ctx) => fn(d, ctx?.peerId ?? '?'));
    },
    onPeerJoin(fn) {
      room.onPeerJoin((ctx: { peerId: string }) => fn(ctx?.peerId ?? '?'));
    },
    onPeerLeave(fn) {
      room.onPeerLeave((ctx: { peerId: string }) => fn(ctx?.peerId ?? '?'));
    },
    leave() {
      room.leave().catch(() => undefined);
    },
  };
}

/** Lokale Verbindung zwischen Tabs desselben Browsers (nur zum Testen, ?net=local) */
export function localTransport(code: string): Transport {
  const bc = new BroadcastChannel('seg-' + code);
  const me = Math.random().toString(36).slice(2);
  const handlers = new Map<string, ((d: unknown, peer: string) => void)[]>();
  const joins: ((p: string) => void)[] = [];
  const leaves: ((p: string) => void)[] = [];
  const peers = new Map<string, number>();
  const post = (ch: string, data: unknown) => bc.postMessage({ from: me, ch, data });
  bc.onmessage = (e) => {
    const { from, ch, data } = e.data as { from: string; ch: string; data: unknown };
    if (from === me) return;
    const known = peers.has(from);
    peers.set(from, performance.now());
    if (ch === '_presence') {
      if (!known) {
        post('_presence', null);
        joins.forEach((f) => f(from));
      }
      return;
    }
    if (ch === '_bye') {
      peers.delete(from);
      leaves.forEach((f) => f(from));
      return;
    }
    if (!known) joins.forEach((f) => f(from));
    for (const h of handlers.get(ch) ?? []) h(data, from);
  };
  const beat = window.setInterval(() => {
    post('_presence', null);
    for (const [p, seen] of peers) {
      if (performance.now() - seen > 4000) {
        peers.delete(p);
        leaves.forEach((f) => f(p));
      }
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
