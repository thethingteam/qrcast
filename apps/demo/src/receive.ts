import { cimbar, type CimbarMode } from 'qrcast/cimbar';
import { qr } from 'qrcast/qr';
import { createReceiver, type ReceiveResult, type Receiver } from 'qrcast/receiver';
import { describeError, parseRandomName, randomBody } from './random.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const status = $<HTMLParagraphElement>('status');
const result = $<HTMLParagraphElement>('result');

let receiver: Receiver | null = null;
let lockedAt = 0;
let progress = 0;
let locked = '';

function show(): void {
  status.textContent = `${receiver?.state ?? 'idle'}${locked ? ` · ${locked}` : ''} · ${Math.round(progress * 100)}%`;
}

$<HTMLButtonElement>('camera').addEventListener('click', async () => {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    await video.play();
  } catch (error) {
    status.textContent = describeError(error);
  }
});

function verify(name: string, bytes: Uint8Array): string {
  const random = parseRandomName(name);
  if (!random) return '';
  const expected = randomBody(random.seed, random.size);
  const same = expected.length === bytes.length && expected.every((byte, i) => byte === bytes[i]);
  return same ? ' · random body verified' : ' · RANDOM BODY MISMATCH';
}

function report(received: ReceiveResult): void {
  const seconds = (performance.now() - lockedAt) / 1000;
  const name = received.kind === 'qrcast' ? (received.meta.name ?? 'qrcast.bin') : received.name || 'raw.bin';
  const kbps = received.bytes.length / 1024 / seconds;
  result.textContent =
    `${received.kind} · ${locked} · ${name} · ${received.bytes.length} bytes · ${seconds.toFixed(1)} s from lock` +
    ` · ${kbps.toFixed(1)} KB/s${verify(name, received.bytes)} · `;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([received.bytes as Uint8Array<ArrayBuffer>]));
  // Received names come from the sender: keep only a safe base name.
  link.download = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'download.bin';
  link.textContent = 'download';
  result.append(link);
}

$<HTMLButtonElement>('start').addEventListener('click', async () => {
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
    progress = event.progress;
    show();
  });
  progress = 0;
  locked = '';
  result.textContent = '';
  try {
    report(await receiver.start());
  } catch (error) {
    result.textContent = describeError(error);
  }
});

$<HTMLButtonElement>('stop').addEventListener('click', () => receiver?.stop());
