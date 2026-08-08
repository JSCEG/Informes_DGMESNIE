/*
 * Genera el contorno simplificado que usan los mapas del publicador.
 *
 * El GeoJSON de entidades pesa 5 MB: sirve para análisis, no para imprimirlo en
 * una hoja carta donde el país mide ocho centímetros. Aquí se reduce con
 * Douglas–Peucker hasta la resolución que la hoja puede mostrar, conservando la
 * silueta reconocible de cada entidad.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';

try {
  const args = parseArgs();
  const input = path.resolve(requireArg(args, 'input'));
  const output = path.resolve(args.output || 'config/mexico-estados.json');
  const tolerance = Number(args.tolerance || 0.02);
  const minimumArea = Number(args['min-area'] || 0.005);
  if (!(tolerance > 0 && tolerance < 5)) throw new Error('--tolerance debe estar entre 0 y 5 grados.');

  const source = JSON.parse(await readFile(input, 'utf8'));
  const features = source.features ?? [];
  if (!features.length) throw new Error('El GeoJSON no contiene entidades.');

  let originales = 0;
  let conservados = 0;
  const states = [];
  for (const feature of features) {
    const name = feature.properties?.NOMGEO ?? feature.properties?.name ?? '';
    const rings = [];
    for (const ring of ringsOf(feature.geometry)) {
      originales += ring.length;
      if (boundingArea(ring) < minimumArea) continue;
      const simple = simplify(ring, tolerance);
      if (simple.length < 4) continue;
      conservados += simple.length;
      rings.push(simple.map(([lon, lat]) => [round(lon), round(lat)]));
    }
    if (rings.length) states.push({ name, rings });
  }

  const asset = { schema_version: 1, source: path.basename(input), tolerance, states };
  await mkdir(path.dirname(output), { recursive: true });
  const text = `${JSON.stringify(asset)}\n`;
  await writeFile(output, text);
  console.log(JSON.stringify({
    status: 'map-asset-built',
    output,
    states: states.length,
    vertices_originales: originales,
    vertices_conservados: conservados,
    reduccion_pct: Number((100 - (conservados / originales) * 100).toFixed(1)),
    bytes: Buffer.byteLength(text, 'utf8')
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

// Se descartan islotes cuya caja no alcanza a dibujarse a la escala del papel.
function boundingArea(ring) {
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  return (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats));
}

function round(value) {
  return Number(value.toFixed(3));
}

// Douglas–Peucker iterativo: la recursión desborda la pila con anillos de
// decenas de miles de vértices.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let farthest = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicular(points[i], points[first], points[last]);
      if (distance > farthest) {
        farthest = distance;
        index = i;
      }
    }
    if (index === -1) continue;
    keep[index] = 1;
    stack.push([first, index], [index, last]);
  }
  return points.filter((_, index) => keep[index]);
}

function perpendicular(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
