type Position = readonly number[];
type Shape = { kind: 'point'; at: Position } | { kind: 'line'; points: Position[] } | { kind: 'area'; ring: Position[] };

function collect(geometry: unknown, out: Shape[]): void {
  if (typeof geometry !== 'object' || geometry === null) return;
  const { type, coordinates, geometries } = geometry as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
  switch (type) {
    case 'Point':
      out.push({ kind: 'point', at: coordinates as Position });
      break;
    case 'MultiPoint':
      for (const at of list(coordinates)) out.push({ kind: 'point', at: at as Position });
      break;
    case 'LineString':
      out.push({ kind: 'line', points: list(coordinates) as Position[] });
      break;
    case 'MultiLineString':
      for (const points of list(coordinates)) out.push({ kind: 'line', points: points as Position[] });
      break;
    case 'Polygon':
      for (const ring of list(coordinates)) out.push({ kind: 'area', ring: ring as Position[] });
      break;
    case 'MultiPolygon':
      for (const polygon of list(coordinates)) for (const ring of list(polygon)) out.push({ kind: 'area', ring: ring as Position[] });
      break;
    case 'GeometryCollection':
      for (const inner of list(geometries)) collect(inner, out);
      break;
  }
}

function shapesOf(value: unknown): Shape[] {
  const out: Shape[] = [];
  const { type, features, geometry } = (value ?? {}) as Record<string, unknown>;
  if (type === 'FeatureCollection' && Array.isArray(features)) {
    for (const feature of features) collect((feature as { geometry?: unknown })?.geometry, out);
  } else if (type === 'Feature') {
    collect(geometry, out);
  } else {
    collect(value, out);
  }
  return out;
}

/**
 * Draws GeoJSON as an SVG string, scaled to fit its bounding box with no map
 * layer. Returns null when the text is not GeoJSON with any drawable shape.
 * The output holds only numbers, so it is safe to insert as HTML.
 */
export function geojsonToSvg(text: string, size = 320): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const shapes = shapesOf(parsed);
  const all = shapes.flatMap((shape) => (shape.kind === 'point' ? [shape.at] : shape.kind === 'line' ? shape.points : shape.ring));
  const valid = all.filter((p) => p.length >= 2 && p.every((n) => Number.isFinite(n)));
  if (valid.length === 0) return null;

  const xs = valid.map((p) => p[0]!);
  const ys = valid.map((p) => p[1]!);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 16;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (size - 2 * pad) / span;
  const width = Math.round((maxX - minX) * scale + 2 * pad);
  const height = Math.round((maxY - minY) * scale + 2 * pad);
  const x = (p: Position) => (pad + (p[0]! - minX) * scale).toFixed(1);
  const y = (p: Position) => (pad + (maxY - p[1]!) * scale).toFixed(1);
  const path = (points: Position[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p)} ${y(p)}`).join(' ');

  const parts = shapes.map((shape) => {
    if (shape.kind === 'point') return `<circle cx="${x(shape.at)}" cy="${y(shape.at)}" r="4" fill="currentColor"/>`;
    if (shape.kind === 'line') return `<path d="${path(shape.points)}" fill="none" stroke="currentColor" stroke-width="2"/>`;
    return `<path d="${path(shape.ring)} Z" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="2"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="GeoJSON preview">${parts.join('')}</svg>`;
}
