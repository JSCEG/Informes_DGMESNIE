import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../scripts/lib/render.mjs';

const manifest = {
  release_id: '2026-08-04-vtest',
  source_count: 0,
  content_sha256: 'a'.repeat(64)
};

const contract = {
  slug: 'radar-regulatorio-energetico',
  title: 'Informe de prueba',
  subtitle: 'Contenido trazable',
  description: 'Contenido trazable',
  cutoff: '2026-08-04',
  version: 'test',
  status: 'borrador local',
  publication_scope: 'local-only',
  content_notice: 'Prueba local.',
  optional_pdf: null,
  highlights: [],
  sources: [],
  sections: [
    { id: 'capitulo-vacio', number: '1', level: 1, title: 'Capítulo agrupador', blocks: [] },
    { id: 'diagrama', number: '1.1', level: 2, title: 'Diagrama', blocks: [{ type: 'flow', direction: 'LR', nodes: [{ id: 'A', label: 'Ley' }, { id: 'B', label: 'Reglamento' }], edges: [{ source: 'A', target: 'B' }] }] }
  ]
};

test('omite la hoja interior de un capítulo agrupador sin contenido', () => {
  const html = renderReport(contract, manifest);
  assert.match(html, /class="chapter-opener" id="capitulo-vacio"/);
  assert.doesNotMatch(html, /id="capitulo-vacio-detalle"/);
});

test('convierte el flujo canónico en SVG accesible', () => {
  const html = renderReport(contract, manifest);
  assert.match(html, /<svg class="flow-diagram"/);
  assert.match(html, /Diagrama de relaciones normativas/);
  assert.match(html, /Ley → Reglamento/);
});
