// Copies the MediaPipe WASM runtime out of node_modules and downloads the
// Hand Landmarker model into public/. Both are served locally so the
// experience works offline after setup.
//
// Model source: Google MediaPipe, Apache License 2.0
// https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const soft = process.argv.includes('--soft');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const modelPath = resolve(root, 'public/models/hand_landmarker.task');
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = resolve(root, 'public/mediapipe/wasm');

function fail(msg) {
  console[soft ? 'warn' : 'error'](`[fetch-model] ${msg}`);
  if (!soft) process.exit(1);
}

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true });
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log('[fetch-model] MediaPipe WASM copied to public/mediapipe/wasm');
} else {
  fail('MediaPipe WASM not found in node_modules — run npm install first.');
}

if (existsSync(modelPath) && statSync(modelPath).size > 1_000_000) {
  console.log('[fetch-model] Hand Landmarker model already present.');
} else {
  try {
    console.log('[fetch-model] Downloading Hand Landmarker model…');
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(modelPath), { recursive: true });
    writeFileSync(modelPath, buf);
    console.log(`[fetch-model] Saved ${(buf.length / 1e6).toFixed(1)} MB to public/models/hand_landmarker.task`);
  } catch (err) {
    fail(
      `Could not download the model (${err.message}).\n` +
        `  Download it manually from:\n  ${MODEL_URL}\n  and save it as public/models/hand_landmarker.task`,
    );
  }
}
