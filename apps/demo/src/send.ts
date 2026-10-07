import { cimbar, type CimbarMode } from 'qrcast/cimbar';
import { qr } from 'qrcast/qr';
import { createSender, type Sender } from 'qrcast/sender';
import { exampleById } from './examples.js';
import { shortHash } from './hash.js';
import { describeError, randomBody, randomName } from './random.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLParagraphElement>('status');
const canvas = $<HTMLCanvasElement>('canvas');
const stage = $<HTMLDivElement>('stage');

/** Bytes per frame for each cimbar mode (design notes). */
const CIMBAR_CAPACITY: Record<CimbarMode, number> = { B: 7500, Bm: 5148, Bu: 3240, '4C': 7500 };

const choice = new URLSearchParams(location.search).get('example') ?? 'text';
const fixed = exampleById(choice);
const isRandom = choice === 'random';
const isFile = choice === 'file';

interface Payload {
  bytes: Uint8Array;
  name: string;
  type: string;
}

let payload: Payload | null = null;
let sender: Sender | null = null;
let frames = 0;
let token = 0;
let failed = false;

async function loadPayload(): Promise<Payload | null> {
  if (fixed) return { bytes: await fixed.bytes(), name: fixed.name, type: fixed.type };
  if (isRandom) {
    const seed = Number($<HTMLInputElement>('seed').value) || 1;
    const size = Math.round((Number($<HTMLInputElement>('size').value) || 1) * 1024);
    return { bytes: randomBody(seed, size), name: randomName(seed, size), type: 'application/octet-stream' };
  }
  const file = $<HTMLInputElement>('file').files?.[0];
  if (!file) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, type: file.type };
}

function formatSize(bytes: number): string {
  return bytes < 10_000 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB (${bytes} bytes)`;
}

async function refreshPayload(): Promise<void> {
  const mine = ++token;
  try {
    const loaded = await loadPayload();
    if (mine !== token) return;
    payload = loaded;
    $('fact-name').textContent = loaded?.name ?? 'choose a file';
    $('fact-size').textContent = loaded ? formatSize(loaded.bytes.length) : '–';
    $('fact-hash').textContent = loaded ? await shortHash(loaded.bytes) : '–';
  } catch (error) {
    status.textContent = describeError(error);
  }
  updateEstimate();
}

function codecName(): 'cimbar' | 'qr' {
  return (document.querySelector<HTMLInputElement>('input[name="codec"]:checked')?.value ?? 'cimbar') as 'cimbar' | 'qr';
}

function updateEstimate(): void {
  $('block-size-value').textContent = $<HTMLInputElement>('block-size').value;
  $('fps-value').textContent = $<HTMLInputElement>('fps').value;
  const estimate = $('estimate');
  if (!payload) {
    estimate.textContent = '';
    return;
  }
  const fps = Number($<HTMLInputElement>('fps').value);
  let sourceFrames: number;
  let pictures: number;
  if (codecName() === 'qr') {
    const layers = Number($<HTMLSelectElement>('layers').value);
    const blocks = Math.ceil(payload.bytes.length / Number($<HTMLInputElement>('block-size').value));
    sourceFrames = Math.ceil(blocks / layers);
    pictures = Math.ceil((blocks * 1.25) / layers);
  } else {
    sourceFrames = Math.ceil(payload.bytes.length / CIMBAR_CAPACITY[$<HTMLSelectElement>('mode').value as CimbarMode]);
    pictures = sourceFrames;
  }
  const seconds = Math.ceil(pictures / fps);
  estimate.textContent = `At most ${sourceFrames} ${sourceFrames === 1 ? 'frame' : 'frames'} to send the data once, about ${seconds} s with repair frames (before compression).`;
}

function showCodecOptions(): void {
  const isQr = codecName() === 'qr';
  $('cimbar-options').hidden = isQr;
  $('qr-options').hidden = !isQr;
  updateEstimate();
}

const pill = $<HTMLSpanElement>('state');
const startButton = $<HTMLButtonElement>('start');
const stopButton = $<HTMLButtonElement>('stop');

function setPill(text: string, tone: 'idle' | 'busy' | 'bad'): void {
  pill.textContent = text;
  pill.dataset.tone = tone;
}

/** The picture's own size and how many screen pixels it gets: compare with the receiver's camera. */
function showCodeInfo(): void {
  const info = $('code-info');
  if (!canvas.width || !sender || sender.state !== 'playing') {
    info.textContent = '';
    return;
  }
  const shown = Math.round(canvas.getBoundingClientRect().width * window.devicePixelRatio);
  info.textContent =
    `Code ${canvas.width}×${canvas.height} px, shown at ${shown} px wide on this screen ` +
    `(${(shown / canvas.width).toFixed(2)}×). A bigger code is easier to read from far away.`;
}
window.addEventListener('resize', showCodeInfo);
document.addEventListener('fullscreenchange', showCodeInfo);

function show(): void {
  const state = sender?.state ?? 'idle';
  if (state === 'loading') setPill('Preparing the code…', 'busy');
  else if (state === 'playing') setPill('Showing the code', 'busy');
  else setPill(failed ? 'Failed' : 'Idle', failed ? 'bad' : 'idle');
  status.textContent = state === 'playing' ? `Frame ${frames}. Point the receiver's camera at the code.` : '';
  const active = state === 'loading' || state === 'playing';
  startButton.textContent = active ? 'Restart with these settings' : 'Start';
  stopButton.disabled = !active;
  showCodeInfo();
}

function codec() {
  const fps = Number($<HTMLInputElement>('fps').value);
  if (codecName() === 'qr') {
    return qr({
      layers: Number($<HTMLSelectElement>('layers').value) as 1 | 3,
      blockSize: Number($<HTMLInputElement>('block-size').value),
      fps,
    });
  }
  return cimbar({ mode: $<HTMLSelectElement>('mode').value as CimbarMode, fps });
}

// The sparsest settings that the library supports, for a small sending screen.
$<HTMLButtonElement>('preset').addEventListener('click', () => {
  if (codecName() === 'qr') {
    $<HTMLSelectElement>('layers').value = '1';
    $<HTMLInputElement>('block-size').value = '200';
  } else {
    $<HTMLSelectElement>('mode').value = 'Bu';
  }
  updateEstimate();
});

for (const id of ['mode', 'layers', 'block-size', 'fps']) $(id).addEventListener('input', updateEstimate);
for (const radio of document.querySelectorAll('input[name="codec"]')) radio.addEventListener('change', showCodecOptions);
for (const id of ['seed', 'size', 'file']) $(id).addEventListener('input', () => void refreshPayload());

startButton.addEventListener('click', async () => {
  try {
    if (!payload) throw new Error('Choose a file first.');
    // A new codec per start, so option changes apply.
    sender?.destroy();
    sender = createSender({ codec: codec(), canvas });
    sender.on('state', show);
    sender.on('frame', ({ frame }) => {
      frames = frame;
      show();
    });
    sender.on('error', ({ error }) => {
      failed = true;
      show();
      status.textContent = describeError(error);
    });
    frames = 0;
    failed = false;
    setPill('Preparing the code…', 'busy');
    stopButton.disabled = false;
    await sender.start(payload.bytes, { name: payload.name, type: payload.type });
    // On a phone the code is below the controls: bring it into view.
    stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    failed = true;
    show();
    status.textContent = describeError(error);
  }
});

stopButton.addEventListener('click', () => sender?.stop());

const fullscreen = $<HTMLButtonElement>('fullscreen');
if (stage.requestFullscreen) {
  fullscreen.addEventListener('click', () => void stage.requestFullscreen().catch(() => {}));
} else {
  fullscreen.hidden = true;
}

$('title').textContent = fixed ? `Send: ${fixed.title}` : isRandom ? 'Send: random body' : 'Send: your own file';
$('random-options').hidden = !isRandom;
$('file-options').hidden = !isFile;
showCodecOptions();
void refreshPayload();
