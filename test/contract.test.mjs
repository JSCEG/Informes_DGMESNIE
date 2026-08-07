import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPolicy, validateContract } from '../scripts/lib/contract.mjs';

const policy = await loadPolicy();
const fixture = JSON.parse(await readFile('fixtures/radar-regulatorio.publicable.json', 'utf8'));

test('acepta el fixture público sanitizado', () => {
  assert.deepEqual(validateContract(fixture, policy), []);
});

for (const [name, mutate, expected] of [
  ['candidato no aprobado', (value) => { value.classification = 'public-candidate'; value.publication_approved = false; }, 'clasificación'],
  ['ruta local', (value) => { value.summary = 'Origen C:\\privado\\fuente.md'; }, 'ruta local'],
  ['correo', (value) => { value.summary = 'Contactar a persona@example.org'; }, 'correo electrónico'],
  ['SharePoint', (value) => { value.summary = 'https://tenant.sharepoint.com/doc'; }, 'SharePoint/OneDrive'],
  ['secreto', (value) => { value.summary = 'SG.abcdefghijklmnop.qrstuvwxyz123456'; }, 'token SendGrid'],
  ['fuente HTTP', (value) => { value.sources[0].url = 'http://www.dof.gob.mx/'; }, 'no usa HTTPS'],
  ['dominio no permitido', (value) => { value.sources[0].url = 'https://example.com/'; }, 'dominio no permitido'],
  ['campo privado', (value) => { value._private = { source_path: 'oculto' }; }, 'Campo prohibido']
]) {
  test(`bloquea ${name}`, () => {
    const changed = structuredClone(fixture);
    mutate(changed);
    assert.match(validateContract(changed, policy).join('\n'), new RegExp(expected, 'i'));
  });
}

test('la política admite la escala observada del radar real sin relajar la aprobación', () => {
  const changed = structuredClone(fixture);
  changed.sections = Array.from({ length: 52 }, (_, index) => ({ id: `seccion-${index + 1}`, title: `Sección ${index + 1}`, blocks: [{ type: 'paragraph', text: 'Contenido público revisado.' }] }));
  assert.deepEqual(validateContract(changed, policy), []);
});
