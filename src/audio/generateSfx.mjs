/**
 * Génération one-shot des samples audio (WAV 44.1 kHz mono 16 bits)
 * dans public/sfx/. Aucun asset externe : tout est synthétisé ici,
 * avec un rendu plus riche que la synthèse temps réel (filtres biquad,
 * enveloppes multiples, couches de bruit).
 *
 *   node src/audio/generateSfx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'sfx');
mkdirSync(OUT, { recursive: true });

/* ---------- DSP utilitaires ---------- */

/** Filtre biquad (RBJ cookbook). */
function biquad(type, f0, q) {
  const w0 = (2 * Math.PI * f0) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw = Math.cos(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
    a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
    a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
  } else {
    // bandpass (constant peak gain)
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function seconds(s) {
  return Math.round(s * SR);
}

function buffer(durationS) {
  return new Float64Array(seconds(durationS));
}

/** Bruit filtré avec enveloppe expo, mixé dans buf à partir de `at`. */
function noiseBurst(buf, { at = 0, dur, type = 'bandpass', freq, q = 2, gain = 0.5, decay = 6 }) {
  const start = seconds(at);
  const n = seconds(dur);
  const f = biquad(type, freq, q);
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const env = Math.exp((-decay * i) / n);
    buf[start + i] += f(Math.random() * 2 - 1) * env * gain;
  }
}

/** Ton avec enveloppe attaque/decay, mixé dans buf. */
function tone(buf, { at = 0, dur, freq, gain = 0.15, type = 'sine', decay = 5, attack = 0.008 }) {
  const start = seconds(at);
  const n = seconds(dur);
  const atk = seconds(attack);
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / SR;
    const phase = 2 * Math.PI * freq * t;
    let s;
    if (type === 'sine') s = Math.sin(phase);
    else if (type === 'triangle') s = (2 / Math.PI) * Math.asin(Math.sin(phase));
    else s = Math.sign(Math.sin(phase)); // square
    const env = (i < atk ? i / atk : Math.exp((-decay * (i - atk)) / n));
    buf[start + i] += s * env * gain;
  }
}

/** Écrit un WAV mono 16 bits. */
function writeWav(name, buf) {
  // Normalisation douce si dépassement.
  let peak = 0;
  for (const s of buf) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0.98 ? 0.98 / peak : 1;
  const pcm = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(buf[i] * scale * 32767)));
  }
  const dataSize = pcm.length * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  Buffer.from(pcm.buffer).copy(wav, 44);
  writeFileSync(join(OUT, name), wav);
  console.log(`  ${name}  (${(wav.length / 1024).toFixed(1)} Ko)`);
}

/* ---------- Recettes ---------- */

// Jeton céramique : double clic mat + résonance brève.
{
  const b = buffer(0.14);
  noiseBurst(b, { dur: 0.03, freq: 2900, q: 9, gain: 0.7, decay: 7 });
  noiseBurst(b, { at: 0.028, dur: 0.05, freq: 2100, q: 6, gain: 0.5, decay: 8 });
  tone(b, { at: 0.002, dur: 0.06, freq: 1850, gain: 0.16, type: 'triangle', decay: 9 });
  tone(b, { at: 0.03, dur: 0.08, freq: 940, gain: 0.08, type: 'sine', decay: 8 });
  writeWav('chip.wav', b);
}

// Pile de jetons : cascade de trois contacts.
{
  const b = buffer(0.22);
  noiseBurst(b, { dur: 0.04, freq: 2400, q: 7, gain: 0.55, decay: 7 });
  noiseBurst(b, { at: 0.05, dur: 0.05, freq: 2900, q: 8, gain: 0.5, decay: 8 });
  noiseBurst(b, { at: 0.11, dur: 0.05, freq: 2000, q: 6, gain: 0.42, decay: 8 });
  tone(b, { at: 0.02, dur: 0.09, freq: 1500, gain: 0.1, type: 'triangle', decay: 9 });
  writeWav('chip_stack.wav', b);
}

// Glisse de carte sur feutre : souffle bandpass modulé.
{
  const b = buffer(0.19);
  noiseBurst(b, { dur: 0.18, freq: 850, q: 1.1, gain: 0.5, decay: 4 });
  noiseBurst(b, { at: 0.01, dur: 0.12, freq: 1900, q: 2.5, gain: 0.18, decay: 6 });
  writeWav('card_slide.wav', b);
}

// Flip de carte : claquement papier sec + retombée feutrée.
{
  const b = buffer(0.17);
  noiseBurst(b, { dur: 0.05, type: 'highpass', freq: 2300, q: 0.9, gain: 0.5, decay: 8 });
  noiseBurst(b, { at: 0.055, dur: 0.1, freq: 700, q: 2, gain: 0.4, decay: 6 });
  writeWav('card_flip.wav', b);
}

// Mélange du sabot : riffle de six flutters.
{
  const b = buffer(0.55);
  for (let i = 0; i < 6; i++) {
    noiseBurst(b, { at: i * 0.075, dur: 0.08, freq: 1050 + i * 160, q: 2, gain: 0.32, decay: 6 });
  }
  noiseBurst(b, { at: 0.42, dur: 0.12, freq: 600, q: 1.4, gain: 0.28, decay: 5 });
  writeWav('shuffle.wav', b);
}

// Gain simple : tierce feutrée (mi-si).
{
  const b = buffer(0.6);
  tone(b, { dur: 0.4, freq: 659.25, gain: 0.16, type: 'sine', decay: 5 });
  tone(b, { at: 0.09, dur: 0.5, freq: 987.77, gain: 0.11, type: 'sine', decay: 5 });
  writeWav('win.wav', b);
}

// Perte : chute grave discrète.
{
  const b = buffer(0.55);
  tone(b, { dur: 0.42, freq: 146.83, gain: 0.2, type: 'sine', decay: 5 });
  tone(b, { at: 0.05, dur: 0.5, freq: 110, gain: 0.12, type: 'sine', decay: 5 });
  writeWav('lose.wav', b);
}

// Égalité : tick neutre.
{
  const b = buffer(0.2);
  tone(b, { dur: 0.16, freq: 440, gain: 0.11, type: 'triangle', decay: 7 });
  writeWav('push.wav', b);
}

// Blackjack : arpège majeur ascendant.
{
  const b = buffer(0.95);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    tone(b, { at: i * 0.1, dur: 0.5, freq: f, gain: 0.13, type: 'triangle', decay: 5 });
  });
  writeWav('blackjack.wav', b);
}

// Gros gain : arpège riche + scintillement.
{
  const b = buffer(1.1);
  [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
    tone(b, { at: i * 0.09, dur: 0.6, freq: f, gain: 0.12, type: 'triangle', decay: 5 });
  });
  noiseBurst(b, { at: 0.2, dur: 0.5, type: 'highpass', freq: 5200, q: 0.9, gain: 0.07, decay: 5 });
  writeWav('bigwin.wav', b);
}

// Clic UI.
{
  const b = buffer(0.07);
  tone(b, { dur: 0.045, freq: 1200, gain: 0.09, type: 'square', decay: 9 });
  writeWav('click.wav', b);
}

console.log(`Samples générés dans ${OUT}`);
