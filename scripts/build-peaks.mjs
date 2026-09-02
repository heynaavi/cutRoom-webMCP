// RMS envelope for the waveform. Decodes to 8kHz mono PCM and buckets it.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const [, , src, out, nStr] = process.argv;
const N = +(nStr || 2400);
const r = spawnSync("ffmpeg", ["-v", "error", "-i", src, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], {
  maxBuffer: 1 << 30, encoding: "buffer",
});
if (r.status !== 0) { console.error(r.stderr?.toString().slice(0, 400)); process.exit(1); }
const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 2));
const per = Math.floor(pcm.length / N);
const peaks = [];
for (let i = 0; i < N; i++) {
  let sum = 0;
  const a = i * per, b = a + per;
  for (let k = a; k < b; k += 3) sum += pcm[k] * pcm[k];      // stride: RMS is stable enough
  peaks.push(Math.sqrt(sum / Math.max(1, (b - a) / 3)) / 32768);
}
const max = Math.max(...peaks) || 1;
// gamma lifts quiet speech so the bars read as speech, not near-silence
const norm = peaks.map((p) => +Math.min(1, Math.pow(p / max, 0.62)).toFixed(3));
writeFileSync(out, JSON.stringify(norm));
console.log(`peaks=${norm.length} max=${max.toFixed(4)} mean=${(norm.reduce((a,b)=>a+b,0)/norm.length).toFixed(3)}`);
