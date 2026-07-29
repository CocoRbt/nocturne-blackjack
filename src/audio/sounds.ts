/**
 * Moteur audio du casino.
 *
 * Priorité aux samples WAV pré-générés (public/sfx), avec fallback synthèse.
 * L'ambiance de salle est un bruit brownien filtré (identity.ambienceHz).
 */

export type SoundName =
  | 'chip'
  | 'chipStack'
  | 'cardSlide'
  | 'cardFlip'
  | 'shuffle'
  | 'win'
  | 'lose'
  | 'push'
  | 'blackjack'
  | 'bigwin'
  | 'click'
  | 'card'
  | 'flip'
  | 'bigWin';

type SampleKey =
  | 'chip'
  | 'chipStack'
  | 'cardSlide'
  | 'cardFlip'
  | 'shuffle'
  | 'win'
  | 'lose'
  | 'push'
  | 'blackjack'
  | 'bigwin'
  | 'click';

const SAMPLE_FILES: Record<SampleKey, string> = {
  chip: 'chip.wav',
  chipStack: 'chip_stack.wav',
  cardSlide: 'card_slide.wav',
  cardFlip: 'card_flip.wav',
  shuffle: 'shuffle.wav',
  win: 'win.wav',
  lose: 'lose.wav',
  push: 'push.wav',
  blackjack: 'blackjack.wav',
  bigwin: 'bigwin.wav',
  click: 'click.wav',
};

function resolve(name: SoundName): SampleKey {
  if (name === 'card') return 'cardSlide';
  if (name === 'flip') return 'cardFlip';
  if (name === 'bigWin') return 'bigwin';
  return name;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;
  private muted = false;
  private buffers = new Map<SampleKey, AudioBuffer>();
  private loading = false;
  private pendingAmbienceHz = 220;
  private ambienceStarted = false;

  private ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      void this.loadSamples();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private async loadSamples(): Promise<void> {
    if (this.loading || !this.ctx) return;
    this.loading = true;
    const base = import.meta.env.BASE_URL ?? '/';
    await Promise.all(
      (Object.keys(SAMPLE_FILES) as SampleKey[]).map(async (name) => {
        try {
          const res = await fetch(`${base}sfx/${SAMPLE_FILES[name]}`);
          if (!res.ok) return;
          const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(name, buf);
        } catch {
          // Fallback synthèse.
        }
      }),
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  setAmbienceProfile(hz: number): void {
    this.pendingAmbienceHz = hz;
    if (this.ambienceFilter && this.ctx) {
      this.ambienceFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.6);
    }
  }

  /** Premier geste utilisateur : démarre le contexte + lit d'ambiance. */
  startAmbience(): void {
    this.ensure();
    this.beginAmbience();
  }

  play(name: SoundName): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.beginAmbience();
    const key = resolve(name);
    const sample = this.buffers.get(key);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
    this.synth(key, ctx, this.master);
  }

  private beginAmbience(): void {
    if (this.ambienceStarted || !this.ctx || !this.master) return;
    this.ambienceStarted = true;
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.pendingAmbienceHz;
    const gain = ctx.createGain();
    gain.gain.value = 0.008;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.ambienceFilter = filter;
  }

  private noise(ctx: AudioContext, out: AudioNode, dur: number, freq: number, q: number, gain: number): void {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(out);
    src.start();
  }

  private tone(
    ctx: AudioContext,
    out: AudioNode,
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    at = 0,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private synth(name: SampleKey, ctx: AudioContext, out: AudioNode): void {
    switch (name) {
      case 'chip':
        this.noise(ctx, out, 0.06, 2600, 8, 0.5);
        this.tone(ctx, out, 1800, 0.05, 0.12, 'triangle');
        break;
      case 'chipStack':
        this.noise(ctx, out, 0.05, 2400, 7, 0.4);
        setTimeout(() => this.noise(ctx, out, 0.05, 2900, 8, 0.35), 50);
        setTimeout(() => this.noise(ctx, out, 0.05, 2000, 6, 0.3), 110);
        break;
      case 'cardSlide':
        this.noise(ctx, out, 0.16, 900, 1.2, 0.35);
        break;
      case 'cardFlip':
        this.noise(ctx, out, 0.05, 2500, 1, 0.35);
        setTimeout(() => this.noise(ctx, out, 0.08, 700, 2, 0.28), 55);
        break;
      case 'shuffle':
        for (let i = 0; i < 6; i++) {
          setTimeout(() => this.noise(ctx, out, 0.07, 1100 + i * 150, 2, 0.25), i * 75);
        }
        break;
      case 'win':
        this.tone(ctx, out, 659.25, 0.35, 0.14);
        this.tone(ctx, out, 987.77, 0.45, 0.1, 'sine', 0.09);
        break;
      case 'lose':
        this.tone(ctx, out, 146.83, 0.4, 0.16);
        this.tone(ctx, out, 110, 0.45, 0.1, 'sine', 0.05);
        break;
      case 'push':
        this.tone(ctx, out, 440, 0.15, 0.1, 'triangle');
        break;
      case 'blackjack':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone(ctx, out, f, 0.45, 0.11, 'triangle', i * 0.1),
        );
        break;
      case 'bigwin':
        [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          this.tone(ctx, out, f, 0.55, 0.1, 'triangle', i * 0.09),
        );
        break;
      case 'click':
        this.tone(ctx, out, 1200, 0.04, 0.07, 'square');
        break;
    }
  }
}

export const sounds = new SoundEngine();
