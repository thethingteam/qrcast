import { parseRandomName, randomBody } from './random.js';

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** The name sent in the envelope; the receiver finds the example by it. */
  readonly name: string;
  readonly type: string;
  bytes(): Promise<Uint8Array>;
}

const encoder = new TextEncoder();

const TEXT = `qrcast sends bytes from one screen to another camera.
qrcast 把資料從一個螢幕傳到另一個裝置的相機。
qrcastは画面からカメラへバイト列を送ります。

Unicode check: café · naïve · Ünïcödé · 你好 · こんにちは · 안녕하세요 · 🚀📷✅
Lines end with LF, and the last line has no newline.
Pack my box with five dozen liquor jugs.`;

const JSON_TEXT = JSON.stringify(
  {
    name: 'qrcast demo',
    version: 1,
    codecs: ['cimbar', 'qr'],
    qr: { layers: [1, 3], blockSize: { min: 100, max: 2000, default: 800 } },
    note: '你好, qrcast',
    nothing: null,
    ok: true,
  },
  null,
  2,
);

const GEOJSON_TEXT = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Taipei 101' }, geometry: { type: 'Point', coordinates: [121.5645, 25.0339] } },
    { type: 'Feature', properties: { name: 'Taipei Main Station' }, geometry: { type: 'Point', coordinates: [121.5170, 25.0478] } },
    {
      type: 'Feature',
      properties: { name: 'Route' },
      geometry: {
        type: 'LineString',
        coordinates: [[121.517, 25.0478], [121.5226, 25.0418], [121.5434, 25.0418], [121.5645, 25.0339]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Daan Forest Park' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[121.5325, 25.0372], [121.5405, 25.0372], [121.5405, 25.0302], [121.5325, 25.0302], [121.5325, 25.0372]]],
      },
    },
  ],
});

async function fetchImage(): Promise<Uint8Array> {
  const response = await fetch(new URL('tux.png', document.baseURI));
  if (!response.ok) throw new Error(`Could not load tux.png (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'text',
    title: 'Plain text',
    description: 'A short UTF-8 note in several languages. Read it on the other side.',
    name: 'qrcast-example-text.txt',
    type: 'text/plain',
    bytes: async () => encoder.encode(TEXT),
  },
  {
    id: 'json',
    title: 'JSON',
    description: 'A small config object. The receiver parses and formats it.',
    name: 'qrcast-example-json.json',
    type: 'application/json',
    bytes: async () => encoder.encode(JSON_TEXT),
  },
  {
    id: 'geojson',
    title: 'GeoJSON',
    description: 'Points, a route and a park in Taipei, drawn as shapes on the receiver.',
    name: 'qrcast-example-geojson.geojson',
    type: 'application/geo+json',
    bytes: async () => encoder.encode(GEOJSON_TEXT),
  },
  {
    id: 'image',
    title: 'Image',
    description: 'Tux, a small PNG. If it shows, every byte arrived.',
    name: 'qrcast-example-image.png',
    type: 'image/png',
    bytes: fetchImage,
  },
];

/** The fixed examples other than the random body, by id. */
export function exampleById(id: string | null): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}

/** The bytes a received name should carry, or null when the name is unknown. */
export async function expectedBytes(name: string): Promise<Uint8Array | null> {
  const example = EXAMPLES.find((candidate) => candidate.name === name);
  if (example) return example.bytes();
  const random = parseRandomName(name);
  return random ? randomBody(random.seed, random.size) : null;
}
