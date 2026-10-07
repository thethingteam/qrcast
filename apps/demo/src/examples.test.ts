import { expect, test } from 'vitest';
import { EXAMPLES, exampleById, expectedBytes } from './examples.js';
import { geojsonToSvg } from './geojson.js';
import { sha256, shortHash } from './hash.js';
import { randomBody, randomName } from './random.js';
import { formatRate, secondsLeft, wireSize } from './speed.js';

const offline = EXAMPLES.filter((example) => example.id !== 'image');

test('each example has stable bytes and a unique name', async () => {
  expect(new Set(EXAMPLES.map((example) => example.name)).size).toBe(EXAMPLES.length);
  for (const example of offline) {
    const first = await example.bytes();
    const second = await example.bytes();
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
  }
});

test('the name lookup finds each example and the random body', async () => {
  for (const example of offline) {
    expect(await expectedBytes(example.name)).toEqual(await example.bytes());
  }
  expect(await expectedBytes(randomName(3, 1000))).toEqual(randomBody(3, 1000));
  expect(await expectedBytes('holiday.jpg')).toBeNull();
  expect(exampleById('json')?.type).toBe('application/json');
  expect(exampleById('nope')).toBeUndefined();
});

test('the JSON and GeoJSON examples are valid', async () => {
  const decoder = new TextDecoder();
  for (const id of ['json', 'geojson']) {
    const bytes = await exampleById(id)!.bytes();
    expect(() => JSON.parse(decoder.decode(bytes))).not.toThrow();
  }
});

test('hashes match known SHA-256 values', async () => {
  const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  expect(await sha256(new Uint8Array())).toBe(empty);
  expect(await shortHash(new Uint8Array())).toBe('e3b0c442');
  const abc = new TextEncoder().encode('abc');
  expect((await sha256(abc)).startsWith('ba7816bf8f01cfea')).toBe(true);
});

test('GeoJSON becomes an SVG with a shape per geometry', async () => {
  const point = geojsonToSvg('{"type":"Point","coordinates":[1,2]}')!;
  expect(point).toContain('<circle');
  const line = geojsonToSvg('{"type":"LineString","coordinates":[[0,0],[1,1],[2,0]]}')!;
  expect(line).toContain('<path');
  expect(line).not.toContain(' Z"');
  const polygon = geojsonToSvg('{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}')!;
  expect(polygon).toContain(' Z"');
  const collection = new TextDecoder().decode(await exampleById('geojson')!.bytes());
  const svg = geojsonToSvg(collection)!;
  expect(svg.match(/<circle/g)).toHaveLength(2);
  expect(svg.match(/<path/g)).toHaveLength(2);
});

test('GeoJSON that cannot be drawn gives null', () => {
  expect(geojsonToSvg('not json')).toBeNull();
  expect(geojsonToSvg('{"type":"FeatureCollection","features":[]}')).toBeNull();
  expect(geojsonToSvg('{"type":"Point","coordinates":["a"]}')).toBeNull();
});

test('wire size is the deflated size, never more than the input', async () => {
  const zeros = new Uint8Array(100_000);
  expect(await wireSize(zeros)).toBeLessThan(1000);
  expect(await wireSize(randomBody(1, 5000))).toBe(5000);
});

test('rates and the time left', () => {
  expect(formatRate(1024 * 12, 1)).toBe('12.0 KB/s');
  expect(formatRate(1024 * 196, 1)).toBe('196 KB/s');
  expect(formatRate(10, 0)).toBe('–');
  expect(secondsLeft(0.5, 10)).toBe(10);
  expect(secondsLeft(0.01, 10)).toBeNull();
  expect(secondsLeft(1, 10)).toBeNull();
});
