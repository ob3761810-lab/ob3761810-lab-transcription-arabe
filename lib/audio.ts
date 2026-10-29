// Préparation du fichier dans le navigateur, avant l'envoi :
// on extrait le son (aussi pour une vidéo), on le convertit en mono 16 kHz
// et on le découpe en extraits de 2 minutes au format WAV.
// Chaque extrait reste sous la limite de 4,5 Mo acceptée par Vercel.

const SAMPLE_RATE = 16000;
export const CHUNK_SECONDS = 120;

export async function splitIntoWavChunks(file: File): Promise<Blob[]> {
  const fileData = await file.arrayBuffer();
  // Ce contexte décode le fichier directement en 16 kHz.
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await context.decodeAudioData(fileData);
  const samples = toMono(decoded);

  const chunkLength = CHUNK_SECONDS * SAMPLE_RATE;
  const chunks: Blob[] = [];
  for (let start = 0; start < samples.length; start += chunkLength) {
    chunks.push(toWav(samples.subarray(start, start + chunkLength)));
  }
  return chunks;
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mono[i] = (left[i] + right[i]) / 2;
  }
  return mono;
}

// Fabrique un fichier WAV 16 bits à partir des échantillons.
function toWav(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const writeText = (offset: number, text: string) =>
    [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // format PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}
