export const SILENCE_THRESHOLD = 0.025;

export async function toWav(blob: Blob): Promise<Blob> {
  const ab = await blob.arrayBuffer();
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();

  const buf = await new Promise<AudioBuffer>((resolve, reject) => {
    ctx.decodeAudioData(ab, resolve, reject);
  });

  const sampleRate = 16000;
  const length = Math.ceil(buf.duration * sampleRate);
  const off = new OfflineAudioContext(1, length, sampleRate);

  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();

  const out = await off.startRendering();
  try {
    ctx.close();
  } catch {}

  const d = out.getChannelData(0);
  const buffer = new ArrayBuffer(44 + d.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + d.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, 'data');
  view.setUint32(40, d.length * 2, true);

  for (let i = 0; i < d.length; i++) {
    const s = Math.max(-1, Math.min(1, d[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

export function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const res = String(fr.result || '');
      resolve(res.split(',')[1] || '');
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export function countWords(text: string): number {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function getSpeedLabel(wpm: number): string {
  if (wpm < 70) return 'Trop lent';
  if (wpm < 95) return 'Un peu lent';
  if (wpm <= 140) return 'Bonne vitesse';
  if (wpm <= 165) return 'Un peu rapide';
  return 'Trop rapide';
}

export function calculateSpeedScore(wpm: number, pauses: number, errors: number): number {
  let score = 100;

  if (wpm < 70) score -= 30;
  else if (wpm < 95) score -= 15;
  else if (wpm > 165) score -= 25;
  else if (wpm > 140) score -= 10;

  score -= Math.min(15, pauses * 2);
  score -= Math.min(20, errors * 4);

  return Math.max(0, Math.min(100, score));
}
