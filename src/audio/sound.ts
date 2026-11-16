/**
 * Ton ohne Audiodateien: Publikum, Schwerter, Treffer – alles mit der Web-Audio-API erzeugt.
 * Startet erst nach der ersten Berührung (Vorgabe von iOS und Android).
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private crowdBed!: GainNode;
  private crowdChatter!: GainNode;
  private chatterFilter!: BiquadFilterNode;
  private roarGain!: GainNode;
  private booGain!: GainNode;
  private excite = 0.2;
  private chatterTimer = 0;
  enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchend', unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => undefined);
      else if (this.enabled) this.ctx.resume().catch(() => undefined);
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  private start(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Rosa Rauschen (4 s, in Schleife)
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    this.noise = buf;

    // Grundrauschen der Menge
    const bed = this.loop();
    const bedF = ctx.createBiquadFilter();
    bedF.type = 'bandpass';
    bedF.frequency.value = 480;
    bedF.Q.value = 0.5;
    this.crowdBed = ctx.createGain();
    this.crowdBed.gain.value = 0.12;
    bed.connect(bedF).connect(this.crowdBed).connect(this.master);

    // Stimmengewirr: schmales Band, schwankende Lautstärke
    const ch = this.loop(1.3);
    this.chatterFilter = ctx.createBiquadFilter();
    this.chatterFilter.type = 'bandpass';
    this.chatterFilter.frequency.value = 1100;
    this.chatterFilter.Q.value = 2.5;
    this.crowdChatter = ctx.createGain();
    this.crowdChatter.gain.value = 0.05;
    ch.connect(this.chatterFilter).connect(this.crowdChatter).connect(this.master);

    // Jubel (lauter, heller)
    const roar = this.loop(2.1);
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 900;
    rf.Q.value = 0.7;
    const rf2 = ctx.createBiquadFilter();
    rf2.type = 'peaking';
    rf2.frequency.value = 2400;
    rf2.gain.value = 6;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    roar.connect(rf).connect(rf2).connect(this.roarGain).connect(this.master);

    // Buhrufe: tiefes „Uuuh“ aus Formanten
    const boo = this.loop(0.7);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 320;
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 700;
    f2.Q.value = 5;
    const mix = ctx.createGain();
    mix.gain.value = 3;
    boo.connect(f1).connect(mix);
    boo.connect(f2).connect(mix);
    this.booGain = ctx.createGain();
    this.booGain.gain.value = 0;
    mix.connect(this.booGain).connect(this.master);
  }

  private loop(rate = 1): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.loopStart = Math.random() * 3;
    s.start(0, Math.random() * 3);
    return s;
  }

  /** Stimmung der Menge (0..1), jedes Bild aufrufen */
  update(dt: number, excite: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this.excite += (excite - this.excite) * Math.min(1, dt * 2);
    const e = this.excite;
    this.crowdBed.gain.setTargetAtTime(0.1 + e * 0.22, t, 0.3);
    this.chatterTimer -= dt;
    if (this.chatterTimer <= 0) {
      this.chatterTimer = 0.08 + Math.random() * 0.15;
      this.crowdChatter.gain.setTargetAtTime((0.025 + Math.random() * 0.05) * (1 + e), t, 0.05);
      this.chatterFilter.frequency.setTargetAtTime(800 + Math.random() * 900, t, 0.08);
    }
  }

  /** Kurzer Jubel, Stärke 0..1 */
  roar(amount: number, seconds = 2.2): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.roarGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.12 + amount * 0.5, t + 0.25);
    g.setTargetAtTime(0, t + 0.25 + seconds * 0.4, seconds * 0.35);
  }

  boo(seconds = 2.5): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.booGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.5, t + 0.4);
    g.setTargetAtTime(0, t + seconds * 0.6, seconds * 0.3);
  }

  /** Raunen (Spannung, Abstimmung) */
  gasp(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.roarGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.18, t + 0.5);
    g.setTargetAtTime(0.05, t + 1.2, 0.8);
  }

  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', at = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 3, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', glide = 1, at = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide !== 1) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Metall auf Metall (Parade, Schwert am Schildbuckel) */
  clash(strong = false): void {
    if (!this.ctx || !this.enabled) return;
    const v = strong ? 1 : 0.7;
    const base = 1700 + Math.random() * 500;
    for (const [m, g, d] of [
      [1, 0.16, 0.5],
      [1.47, 0.1, 0.38],
      [2.09, 0.07, 0.3],
      [2.76, 0.05, 0.22],
      [3.9, 0.03, 0.15],
    ]) {
      this.tone(base * m, d * (strong ? 1.3 : 1), g * v, 'sine');
    }
    this.burst(4500, 0.8, 0.06, 0.5 * v, 'highpass');
  }

  /** Schlag auf den Holzschild */
  block(heavy = false): void {
    if (!this.ctx || !this.enabled) return;
    this.burst(380, 1.2, heavy ? 0.22 : 0.14, heavy ? 0.9 : 0.6);
    this.tone(140, heavy ? 0.2 : 0.13, heavy ? 0.5 : 0.35, 'sine', 0.7);
    this.burst(2200, 2, 0.04, 0.2);
  }

  /** Treffer ins Fleisch */
  hit(heavy = false): void {
    if (!this.ctx || !this.enabled) return;
    this.burst(700, 0.9, heavy ? 0.2 : 0.12, heavy ? 1.1 : 0.8, 'lowpass');
    this.tone(85, heavy ? 0.25 : 0.15, heavy ? 0.8 : 0.5, 'sine', 0.6);
    this.burst(1800, 3, 0.07, 0.25);
  }

  /** Luftzug eines Schwungs */
  whoosh(heavy = false): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(heavy ? 1300 : 1700, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(heavy ? 0.5 : 0.35, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 3, 0.35);
  }

  /** Körper fällt in den Sand */
  fall(): void {
    if (!this.ctx || !this.enabled) return;
    this.burst(260, 0.7, 0.35, 0.9, 'lowpass');
    this.tone(60, 0.3, 0.6, 'sine', 0.7);
  }

  /** Fanfare (Tuba) für Kampfbeginn und Urteil */
  horn(low = false): void {
    if (!this.ctx || !this.enabled) return;
    const f = low ? 146.8 : 196;
    const notes = low ? [1, 1, 0.75] : [1, 1.25, 1.5];
    notes.forEach((m, i) => {
      this.tone(f * m, 0.42, 0.18, 'sawtooth', 1, i * 0.32);
      this.tone(f * m * 2, 0.42, 0.05, 'sawtooth', 1, i * 0.32);
    });
  }
}
