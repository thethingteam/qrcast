import { cimbar, type CimbarMode } from 'qrcast/cimbar';
import { qr } from 'qrcast/qr';
import { createSender, type Sender } from 'qrcast/sender';
import { describeError, randomBody, randomName } from './random.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const status = $<HTMLParagraphElement>('status');
const canvas = $<HTMLCanvasElement>('canvas');

let sender: Sender | null = null;
let summary = '';
let frames = 0;

function show(): void {
  status.textContent = `${sender?.state ?? 'idle'} · ${summary} · frame ${frames}`;
}

async function body(): Promise<{ bytes: Uint8Array; name: string; type: string }> {
  const source = new FormData(form).get('source');
  if (source === 'file') {
    const file = $<HTMLInputElement>('file').files?.[0];
    if (!file) throw new Error('Choose a file first.');
    return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, type: file.type };
  }
  const seed = Number($<HTMLInputElement>('seed').value);
  const size = Math.round(Number($<HTMLInputElement>('size').value) * 1024);
  return { bytes: randomBody(seed, size), name: randomName(seed, size), type: 'application/octet-stream' };
}

function showCodecOptions(): void {
  const isQr = $<HTMLSelectElement>('codec').value === 'qr';
  $('cimbar-options').hidden = isQr;
  $('qr-options').hidden = !isQr;
}
$<HTMLSelectElement>('codec').addEventListener('change', showCodecOptions);
showCodecOptions();

function codec() {
  const fps = Number($<HTMLInputElement>('fps').value);
  if ($<HTMLSelectElement>('codec').value === 'qr') {
    return qr({
      layers: Number($<HTMLSelectElement>('layers').value) as 1 | 3,
      blockSize: Number($<HTMLInputElement>('block-size').value),
      fps,
    });
  }
  return cimbar({ mode: $<HTMLSelectElement>('mode').value as CimbarMode, fps });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const { bytes, name, type } = await body();
    // A new codec per start, so option changes apply.
    sender?.destroy();
    sender = createSender({ codec: codec(), canvas });
    sender.on('state', show);
    sender.on('frame', ({ frame }) => {
      frames = frame;
      show();
    });
    sender.on('error', ({ error }) => {
      status.textContent = describeError(error);
    });
    summary = `${name} (${bytes.length} bytes)`;
    frames = 0;
    await sender.start(bytes, { name, type });
  } catch (error) {
    status.textContent = describeError(error);
  }
});

$<HTMLButtonElement>('stop').addEventListener('click', () => sender?.stop());
