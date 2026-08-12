/**
 * Moteur audio du casino.
 *
 * Priorité aux samples WAV pré-générés (public/sfx), avec fallback synthèse.
 * Ambiances de salle : bruit brownien + pads doux, profils distincts par table.
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

/** Identifiants d’ambiance (tables BJ + salon / lobby / Stampede). */
export type AmbienceId =
  | 'emeraude'
  | 'onyx'
  | 'imperiale'
  | 'privee'
  | 'salon'
  | 'stampede'
  | 'lobby'
  | 'off';

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

interface AmbienceProfile {
  /** Coupure du bruit de salle (Hz). */
  noiseHz: number;
  noiseGain: number;
  /** Fréquences des pads (sines très bas). */
  pads: readonly number[];
  padGain: number;
  /** Légère modulation du filtre (Hz LFO). */
  lfoHz: number;
}

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

const AMBIENCES: Record<Exclude<AmbienceId, 'off'>, AmbienceProfile> = {
  /** Salon d’entrée — chaud, ouvert, feutre émeraude. */
  emeraude: {
    noiseHz: 240,
    noiseGain: 0.01,
    pads: [130.81, 164.81, 196.0],
    padGain: 0.018,
    lfoHz: 0.07,
  },
  /** Onyx — plus sombre, silence tendu. */
  onyx: {
    noiseHz: 155,
    noiseGain: 0.007,
    pads: [110.0, 130.81, 164.81],
    padGain: 0.014,
    lfoHz: 0.05,
  },
  /** Impériale — riche, un peu plus présent. */
  imperiale: {
    noiseHz: 280,
    noiseGain: 0.011,
    pads: [174.61, 220.0, 261.63, 329.63],
    padGain: 0.02,
    lfoHz: 0.09,
  },
  /** Privée — intimiste, cercle fermé. */
  privee: {
    noiseHz: 210,
    noiseGain: 0.008,
    pads: [146.83, 185.0, 220.0],
    padGain: 0.016,
    lfoHz: 0.06,
  },
  /** Salon des jeux (Mines, Craps…). */
  salon: {
    noiseHz: 200,
    noiseGain: 0.006,
    pads: [123.47, 155.56],
    padGain: 0.01,
    lfoHz: 0.08,
  },
  /**
   * Stampede — prairie au crépuscule :
   * bruit un peu plus ouvert (vent), pads chauds Bb/F, LFO lent.
   */
  stampede: {
    noiseHz: 320,
    noiseGain: 0.009,
    pads: [116.54, 174.61, 233.08, 349.23],
    padGain: 0.015,
    lfoHz: 0.055,
  },
  /** Lobby — souffle très discret. */
  lobby: {
    noiseHz: 180,
    noiseGain: 0.004,
    pads: [98.0],
    padGain: 0.006,
    lfoHz: 0.04,
  },
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
  private muted = false;
  private buffers = new Map<SampleKey, AudioBuffer>();
  private loading = false;

  private ambienceBus: GainNode | null = null;
  private ambienceNoise: AudioBufferSourceNode | null = null;
  private ambiencePads: OscillatorNode[] = [];
  private ambienceLfo: OscillatorNode | null = null;
  private ambienceStarted = false;
  private currentId: AmbienceId = 'off';
  private pendingId: AmbienceId = 'lobby';
  private brownBuffer: AudioBuffer | null = null;
  private switchToken = 0;

  private ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.ambienceBus = this.ctx.createGain();
      this.ambienceBus.gain.value = 0;
      this.ambienceBus.connect(this.master);
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

  /**
   * Change le lit d’ambiance (table / salon / lobby).
   * Crossfade si déjà démarré.
   */
  setAmbience(id: AmbienceId): void {
    this.pendingId = id;
    if (!this.ambienceStarted) return;
    if (id === this.currentId) return;
    void this.transitionTo(id);
  }

  /** @deprecated préférer setAmbience — conserve un réglage grossier via Hz. */
  setAmbienceProfile(hz: number): void {
    if (hz <= 170) this.setAmbience('onyx');
    else if (hz <= 215) this.setAmbience('privee');
    else if (hz <= 250) this.setAmbience('emeraude');
    else this.setAmbience('imperiale');
  }

  /** Premier geste utilisateur : démarre le contexte + lit d’ambiance. */
  startAmbience(): void {
    this.ensure();
    if (!this.ambienceStarted) {
      void this.transitionTo(this.pendingId === 'off' ? 'lobby' : this.pendingId);
    }
  }

  play(name: SoundName): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (!this.ambienceStarted) {
      void this.transitionTo(this.pendingId === 'off' ? 'lobby' : this.pendingId);
    }
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

  private getBrownBuffer(ctx: AudioContext): AudioBuffer {
    if (this.brownBuffer) return this.brownBuffer;
    const len = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    this.brownBuffer = buffer;
    return buffer;
  }

  private stopAmbienceNodes(): void {
    try {
      this.ambienceNoise?.stop();
    } catch {
      /* already stopped */
    }
    this.ambienceNoise = null;
    for (const osc of this.ambiencePads) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.ambiencePads = [];
    try {
      this.ambienceLfo?.stop();
    } catch {
      /* already stopped */
    }
    this.ambienceLfo = null;
  }

  private async transitionTo(id: AmbienceId): Promise<void> {
    const ctx = this.ensure();
    if (!ctx || !this.ambienceBus) return;
    const token = ++this.switchToken;
    const t0 = ctx.currentTime;

    // Fade out
    this.ambienceBus.gain.cancelScheduledValues(t0);
    this.ambienceBus.gain.setValueAtTime(this.ambienceBus.gain.value, t0);
    this.ambienceBus.gain.linearRampToValueAtTime(0.0001, t0 + 0.45);

    await new Promise((r) => setTimeout(r, 460));
    if (token !== this.switchToken) return;

    this.stopAmbienceNodes();
    this.currentId = id;
    this.ambienceStarted = true;

    if (id === 'off') return;

    const profile = AMBIENCES[id];
    const bus = this.ambienceBus;

    // Bruit de salle
    const noise = ctx.createBufferSource();
    noise.buffer = this.getBrownBuffer(ctx);
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = profile.noiseHz;
    filter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = profile.noiseGain;
    noise.connect(filter).connect(noiseGain).connect(bus);
    noise.start();
    this.ambienceNoise = noise;

    // LFO doux sur le filtre
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = profile.lfoHz;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = profile.noiseHz * 0.18;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    this.ambienceLfo = lfo;

    // Pads
    const perPad = profile.padGain / Math.max(1, profile.pads.length);
    for (const freq of profile.pads) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = perPad;
      // Léger detune via delay offset is enough; keep pure for softness
      osc.connect(g).connect(bus);
      osc.start();
      this.ambiencePads.push(osc);
    }

    const t1 = ctx.currentTime;
    bus.gain.cancelScheduledValues(t1);
    bus.gain.setValueAtTime(0.0001, t1);
    bus.gain.linearRampToValueAtTime(1, t1 + 0.7);
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
        this.noise(ctx, out, 0.35, 1200, 0.8, 0.28);
        this.noise(ctx, out, 0.25, 600, 1.2, 0.18);
        break;
      case 'win':
        this.tone(ctx, out, 523.25, 0.2, 0.14, 'triangle');
        this.tone(ctx, out, 659.25, 0.25, 0.12, 'triangle', 0.08);
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
