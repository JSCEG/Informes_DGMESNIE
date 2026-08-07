import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptMarkdown } from '../scripts/lib/markdown.mjs';

test('preserva capítulos y subapartados, omite el índice y etiqueta fuentes', () => {
  const markdown = `---
titulo: "Informe de prueba"
subtitulo: "Corte verificable"
version: "3.6"
---
# Informe de prueba
## Índice
1. [Capítulo](#capitulo)
# 1. Capítulo
Texto principal.
## 1.1 Subapartado
| Campo | Valor |
| --- | --- |
| Fuente | [DOF](https://www.dof.gob.mx/) |
`;
  const result = adaptMarkdown(markdown);
  assert.equal(result.title, 'Informe de prueba');
  assert.equal(result.subtitle, 'Corte verificable');
  assert.deepEqual(result.sections.map(({ level, number, title }) => ({ level, number, title })), [
    { level: 1, number: '1', title: 'Capítulo' },
    { level: 2, number: '1.1', title: 'Subapartado' }
  ]);
  assert.equal(result.sections[1].blocks[0].type, 'table');
  assert.deepEqual(result.sources[0], { label: 'DOF', url: 'https://www.dof.gob.mx/', institution: 'Subapartado' });
});

test('conserva los enlaces en línea del markdown canónico', () => {
  const markdown = '# Informe\n# 1. Capítulo\nEl acuerdo se publicó en [SIDOF](https://sidof.segob.gob.mx/notas/5742012) y sigue vigente.';
  const [section] = adaptMarkdown(markdown).sections;
  const [block] = section.blocks;
  assert.equal(block.text.text, 'El acuerdo se publicó en SIDOF y sigue vigente.');
  assert.deepEqual(block.text.runs, [
    { t: 'El acuerdo se publicó en ' },
    { t: 'SIDOF', u: 'https://sidof.segob.gob.mx/notas/5742012' },
    { t: ' y sigue vigente.' }
  ]);
});

test('califica las etiquetas de fuente repetidas con el documento citado', () => {
  const markdown = '# Informe\n# 1. Capítulo\nPrimero en [SIDOF](https://sidof.segob.gob.mx/notas/5742012).\n\nSegundo en [SIDOF](https://sidof.segob.gob.mx/notas/5745905).\n\nÚnico en [CENACE](https://www.cenace.gob.mx/).';
  const { sources } = adaptMarkdown(markdown);
  assert.deepEqual(sources.map(({ label }) => label), [
    'SIDOF · nota 5742012',
    'SIDOF · nota 5745905',
    'CENACE'
  ]);
});

test('el texto sin enlaces sigue siendo una cadena simple', () => {
  const markdown = '# Informe\n# 1. Capítulo\nTexto sin ligas.';
  assert.equal(adaptMarkdown(markdown).sections[0].blocks[0].text, 'Texto sin ligas.');
});

test('convierte únicamente estructuras normativas explícitas en componentes editoriales', () => {
  const markdown = `# Informe\n# 1. Hallazgo\n> Planeación → proyectos → permisos.\n## 1.1 Relación con planeación\n1. Estrategia.\n2. Plan.\n# 2. Línea del tiempo\n| Fecha | Hito | Efecto |\n|---|---|---|\n| 18 mar 2025 | Decreto | Nueva arquitectura. |\n# 3. Flujo\n\`\`\`mermaid\nflowchart LR\nA["Ley"] --> B["Reglamento"]\n\`\`\``;
  const result = adaptMarkdown(markdown);
  assert.equal(result.sections[0].blocks[0].type, 'process');
  assert.equal(result.sections[1].blocks[0].type, 'steps');
  assert.equal(result.sections[2].blocks[0].type, 'timeline');
  assert.equal(result.sections[3].blocks[0].type, 'flow');
  assert.equal(result.sections[3].blocks[0].direction, 'LR');
  assert.deepEqual(result.sections[3].blocks[0].edges, [{ source: 'A', target: 'B' }]);
});
