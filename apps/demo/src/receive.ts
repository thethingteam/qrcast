import { cimbar, type CimbarMode } from '@thethingteam/qrcast/cimbar';
import { qr } from '@thethingteam/qrcast/qr';
import { createReceiver, type ReceiveResult, type Receiver } from '@thethingteam/qrcast/receiver';
import { expectedBytes } from './examples.js';
import { geojsonToSvg } from './geojson.js';
import { shortHash } from './hash.js';
import { describeError } from './random.js';
import { formatRate, secondsLeft, wireSize } from './speed.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const pill = $<HTMLSpanElement>('state');
const live = $<HTMLParagraphElement>('live');
const progressBar = $<HTMLProgressElement>('progress');
const errorLine = $<HTMLParagraphElement>('error');
const cameraButton = $<HTMLButtonElement>('camera');
const startButton = $<HTMLButtonElement>('start');
const stopButton = $<HTMLButtonElement>('stop');

let receiver: Receiver | null = null;
let lockedAt = 0;
let progress = 0;
let locked = '';
let objectUrl: string | null = null;
let videoFps = 0;
let updates: number[] = [];
let ticker: ReturnType<typeof setInterval> | null = null;

type Tone = 'idle' | 'busy' | 'ok' | 'bad';

function setPill(text: string, tone: Tone): void {
  pill.textContent = text;
  pill.dataset.tone = tone;
}

function running(): boolean {
  return receiver !== null && receiver.state !== 'idle' && receiver.state !== 'destroyed';
}

function syncButtons(): void {
  startButton.disabled = running();
  stopButton.disabled = !running();
}

/** The state pill, the progress bar and the live numbers. */
function show(): void {
  const state = receiver?.state ?? 'idle';
  if (state === 'loading') setPill('Loading the decoder…', 'busy');
  else if (state === 'detecting') setPill('Looking for a code… point the camera at the sender', 'busy');
  else if (state === 'receiving') setPill(`Receiving ${locked} · ${Math.round(progress * 100)}%`, 'busy');
  progressBar.value = Math.round(progress * 100);
  if (state === 'receiving' && lockedAt) {
    const elapsed = (performance.now() - lockedAt) / 1000;
    const left = secondsLeft(progress, elapsed);
    const now = performance.now();
    updates = updates.filter((t) => now - t < 3000);
    live.textContent =
      `${elapsed.toFixed(0)} s since the first code` +
      (left === null ? '' : ` · about ${Math.ceil(left)} s left at this pace`) +
      ` · camera ${videoFps.toFixed(0)} fps · ${(updates.length / 3).toFixed(1)} useful frames/s`;
  } else if (state !== 'receiving') {
    live.textContent = '';
  }
  syncButtons();
}

interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

/** Fills the camera list and the zoom slider from what the open camera offers. */
async function showCameraOptions(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  const lens = $<HTMLSelectElement>('lens');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  lens.replaceChildren(
    ...devices.map((device, i) => new Option(device.label || `Camera ${i + 1}`, device.deviceId)),
  );
  lens.value = track.getSettings().deviceId ?? '';
  $('lens-field').hidden = devices.length < 2;

  // Zoom is not offered everywhere (not on iOS Safari, rarely on webcams).
  const zoom = (track.getCapabilities?.() as { zoom?: ZoomRange } | undefined)?.zoom;
  const slider = $<HTMLInputElement>('zoom');
  $('zoom-field').hidden = !zoom;
  if (zoom) {
    slider.min = String(zoom.min);
    slider.max = String(zoom.max);
    slider.step = String(zoom.step || 0.1);
    const current = (track.getSettings() as { zoom?: number }).zoom ?? zoom.min;
    slider.value = String(current);
    $('zoom-value').textContent = current.toFixed(1);
  }
  $('camera-options').hidden = devices.length < 2 && !zoom;
}

async function openCamera(deviceId?: string): Promise<void> {
  const previous = video.srcObject;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  video.srcObject = stream;
  // Switching cameras keeps the receiver running: it reads whatever the video shows.
  if (previous instanceof MediaStream) for (const track of previous.getTracks()) track.stop();
  await video.play();
  $('camera-info').textContent = `Camera: ${video.videoWidth}×${video.videoHeight}`;
  cameraButton.textContent = 'Close camera';
  await showCameraOptions(stream);
}

function closeCamera(): void {
  receiver?.stop();
  const stream = video.srcObject;
  if (stream instanceof MediaStream) for (const track of stream.getTracks()) track.stop();
  video.srcObject = null;
  $('camera-info').textContent = '';
  $('camera-options').hidden = true;
  cameraButton.textContent = 'Open camera';
}

$<HTMLSelectElement>('lens').addEventListener('change', async (event) => {
  errorLine.textContent = '';
  try {
    await openCamera((event.target as HTMLSelectElement).value);
  } catch (error) {
    errorLine.textContent = describeError(error);
  }
});

$<HTMLInputElement>('zoom').addEventListener('input', async (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  $('zoom-value').textContent = value.toFixed(1);
  const stream = video.srcObject;
  const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
  try {
    await track?.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
  } catch (error) {
    errorLine.textContent = describeError(error);
  }
});

cameraButton.addEventListener('click', async () => {
  errorLine.textContent = '';
  try {
    if (video.srcObject) closeCamera();
    else await openCamera();
  } catch (error) {
    errorLine.textContent = describeError(error);
  }
});

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

/** Decodes as UTF-8, or returns null when the bytes are not valid text. */
function asText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function preview(name: string, bytes: Uint8Array): void {
  const box = $('preview');
  box.replaceChildren();
  const ext = extensionOf(name);
  const text = ['txt', 'json', 'geojson', 'csv', 'md'].includes(ext) ? asText(bytes) : null;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    const img = document.createElement('img');
    img.alt = name;
    img.src = objectUrl ?? '';
    box.append(img);
  } else if (text !== null) {
    let shown = text;
    let note = '';
    if (ext === 'json' || ext === 'geojson') {
      try {
        shown = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        note = 'Not valid JSON. Showing the raw text.';
      }
    }
    const svg = ext === 'geojson' ? geojsonToSvg(text) : null;
    if (svg) box.insertAdjacentHTML('beforeend', svg);
    if (note) {
      const p = document.createElement('p');
      p.className = 'verdict bad small';
      p.textContent = note;
      box.append(p);
    }
    const pre = document.createElement('pre');
    pre.textContent = shown;
    box.append(pre);
  }
}

async function report(received: ReceiveResult): Promise<void> {
  const seconds = (performance.now() - lockedAt) / 1000;
  const name = received.kind === 'qrcast' ? (received.meta.name ?? 'qrcast.bin') : received.name || 'raw.bin';
  const bytes = received.bytes;
  const type = received.kind === 'qrcast' ? (received.meta.type ?? '') : '';

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], type ? { type } : {}));

  $('result').hidden = false;
  $('r-name').textContent = name;
  $('r-codec').textContent = `${received.kind} · ${locked}`;
  $('r-size').textContent = `${bytes.length} bytes`;
  $('r-hash').textContent = await shortHash(bytes);
  // The codes carry the compressed bytes, so speed is measured on those: it can be
  // compared with the code's capacity. The file's own size is only a reference.
  const wire = await wireSize(bytes);
  $('r-wire').textContent =
    wire < bytes.length * 0.9 ? `${wire} bytes (compressed ${(bytes.length / wire).toFixed(1)}×)` : `${wire} bytes (not compressible)`;
  $('r-speed').textContent = `${formatRate(wire, seconds)} over ${seconds.toFixed(1)} s from the first code`;

  const verdict = $('verdict');
  const expected = await expectedBytes(name);
  if (!expected) {
    verdict.className = 'verdict muted';
    verdict.textContent = 'Not a known example: compare the size and hash with the sender.';
  } else if (expected.length === bytes.length && expected.every((byte, i) => byte === bytes[i])) {
    verdict.className = 'verdict ok';
    verdict.textContent = '✓ Matches the example.';
  } else {
    verdict.className = 'verdict bad';
    verdict.textContent = '✗ Does not match the example: the bytes differ.';
  }

  const link = $<HTMLAnchorElement>('download');
  link.href = objectUrl;
  // Received names come from the sender: keep only a safe base name.
  link.download = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'download.bin';
  preview(name, bytes);
}

startButton.addEventListener('click', async () => {
  errorLine.textContent = '';
  try {
    if (!video.srcObject) await openCamera();
  } catch (error) {
    errorLine.textContent = describeError(error);
    setPill('Camera unavailable', 'bad');
    return;
  }
  receiver?.destroy();
  const mode = $<HTMLSelectElement>('mode').value;
  receiver = createReceiver({
    codecs: [cimbar(mode ? { mode: mode as CimbarMode } : {}), qr()],
    video,
    acceptRaw: $<HTMLInputElement>('raw').checked,
  });
  receiver.on('state', show);
  receiver.on('lock', ({ codec }) => {
    lockedAt = performance.now();
    locked = codec;
    show();
  });
  receiver.on('progress', (event) => {
    // Each progress change is a frame that added something.
    if (event.progress !== progress) updates.push(performance.now());
    progress = event.progress;
    show();
  });
  progress = 0;
  updates = [];
  lockedAt = 0;
  locked = '';
  $('result').hidden = true;
  ticker ??= setInterval(show, 500);
  const mine = receiver;
  setPill('Starting…', 'busy');
  syncButtons();
  try {
    const received = await mine.start();
    await report(received);
    setPill('Done', 'ok');
  } catch (error) {
    // A newer start replaced this receiver: it owns the page now.
    if (mine !== receiver) return;
    if (error instanceof Error && 'code' in error && error.code === 'cancelled') {
      setPill('Stopped', 'idle');
    } else {
      errorLine.textContent = describeError(error);
      setPill('Failed', 'bad');
    }
  } finally {
    if (mine === receiver) {
      progressBar.value = Math.round(progress * 100);
      live.textContent = '';
      syncButtons();
    }
  }
});

stopButton.addEventListener('click', () => receiver?.stop());
syncButtons();

// How fast the camera really delivers pictures: dim light often drops it well below 30.
{
  let frames = 0;
  let since = performance.now();
  const count = (): void => {
    frames++;
    const now = performance.now();
    if (now - since >= 1000) {
      videoFps = (frames * 1000) / (now - since);
      frames = 0;
      since = now;
    }
    video.requestVideoFrameCallback(count);
  };
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(count);
}
