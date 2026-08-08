import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from './lib/args.mjs';

const blocked = [/[A-Za-z]:\\/, /\\\\[^\\]+\\/, /@[A-Z0-9.-]+\.[A-Z]{2,}/i, /sharepoint\.com/i, /onedrive(?:\.live)?\.com/i, /\bSG\.[A-Za-z0-9_-]{12,}/, /-----BEGIN .*PRIVATE KEY-----/];

try {
  const root = path.resolve(parseArgs().output || 'dist');
  const files = await walk(root);
  const required = [
    'index.html', 'catalog.json', 'assets/styles.css', 'assets/app.js', 'assets/paginate.js', 'assets/model.js',
    'assets/echarts.min.js', 'assets/qrcode.js',
    'assets/sener-logo.png', 'assets/reno-portada.png', 'assets/reno-anexos.png',
    'assets/mujer.png', 'assets/gobierno-mexico-logo.png', 'assets/gcr-data.js', 'assets/portada-marco-regulatorio.jpg',
    'assets/fonts/Patria_Bold.otf', 'assets/fonts/NotoSans-Medium.ttf',
    'informes/modelo-editorial/index.html'
  ];
  const relative = files.map((file) => path.relative(root, file).replaceAll('\\', '/'));
  for (const name of required) if (!relative.includes(name)) throw new Error(`Falta el artefacto ${name}.`);

  // Cada informe del catálogo debe existir con su manifiesto y al menos una
  // edición inmutable. El publicador sirve varios informes, así que la lista no
  // puede estar escrita a mano.
  const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
  const publicados = (catalog.reports ?? []).filter((report) => report.slug !== 'modelo-editorial');
  if (!publicados.length) throw new Error('El catálogo no declara ningún informe publicado.');
  for (const report of publicados) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(report.slug ?? '')) throw new Error(`Slug de catálogo no válido: ${report.slug}.`);
    for (const name of [`informes/${report.slug}/index.html`, `informes/${report.slug}/manifest.json`]) {
      if (!relative.includes(name)) throw new Error(`Falta el artefacto ${name} declarado en el catálogo.`);
    }
    const version = new RegExp(`^informes/${report.slug}/versiones/[^/]+/index\\.html$`);
    if (!relative.some((name) => version.test(name))) throw new Error(`Falta la versión inmutable de ${report.slug}.`);
  }
  const styles = await readFile(path.join(root, 'assets', 'styles.css'), 'utf8');
  if (!/--sheet-width:\s*8\.5in;/.test(styles) || !/--sheet-height:\s*11in;/.test(styles) || !/aspect-ratio:\s*17\s*\/\s*22/.test(styles) || !/@page\s*\{\s*size:\s*Letter portrait/.test(styles)) throw new Error('El lector no conserva la proporción carta 8.5 × 11 pulgadas.');
  const readerScript = await readFile(path.join(root, 'assets', 'app.js'), 'utf8');
  if (!readerScript.includes('DGMESNIE') || !readerScript.includes('rotateY')) throw new Error('Faltan el folio DGMESNIE o la transición de página.');
  if (!readerScript.includes('reportPagination')) throw new Error('El lector no espera la composición medida por hojas.');
  // La denominación de la unidad responsable es única; cualquier otra variante
  // es un error institucional, no una alternativa de redacción.
  const wrongUnitNames = [
    'Dirección General de Metodologías y Estadísticas del Sector Energético y del Sistema Nacional de Información Energética',
    'Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información de Energía',
    'Dirección General de Metodologías y Estadísticas del SNIE'
  ];
  // Un recurso externo se rompe en el PDF y expone la consulta a un tercero.
  // `canonical` sí debe ser absoluto: aquí sólo importan scripts y hojas.
  for (const name of relative.filter((item) => item.endsWith('.html'))) {
    const html = await readFile(path.join(root, name), 'utf8');
    const external = [
      ...html.matchAll(/<script\b[^>]*?\ssrc="(?:https?:)?\/\/[^"]+"/gi),
      ...html.matchAll(/<link\b[^>]*?\srel="(?:stylesheet|preload|modulepreload)"[^>]*?\shref="(?:https?:)?\/\/[^"]+"/gi)
    ].map((match) => match[0]);
    if (external.length) throw new Error(`${name} carga recursos de un origen externo: ${external.join(' ')}.`);
    const wrong = wrongUnitNames.find((candidate) => html.includes(candidate));
    if (wrong) throw new Error(`${name} usa una denominación incorrecta de la unidad responsable: "${wrong}".`);
  }
  const modelHtml = await readFile(path.join(root, 'informes', 'modelo-editorial', 'index.html'), 'utf8');
  for (const marker of ['modelo-portadilla', 'modelo-indice-figuras', 'modelo-indice-tablas', 'modelo-enlaces', 'modelo-mixta', 'modelo-video', 'modelo-ficha-tecnica', 'model-year-mask', 'Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética']) {
    if (!modelHtml.includes(marker)) throw new Error(`Falta el componente editorial ${marker}.`);
  }
  const modelScript = await readFile(path.join(root, 'assets', 'model.js'), 'utf8');
  if (!modelScript.includes('model-mixed-chart') || !modelScript.includes('map-popup')) throw new Error('Faltan la gráfica mixta o el popup del mapa.');
  for (const file of files) {
    const bytes = await readFile(file);
    const relativePath = path.relative(root, file).replaceAll('\\', '/');
    const vendored = {
      'assets/echarts.min.js': ['ECharts', 'node_modules/echarts/dist/echarts.min.js'],
      'assets/qrcode.js': ['el generador de QR', 'node_modules/qrcode-generator/dist/qrcode.js']
    }[relativePath];
    if (vendored) {
      const trustedBytes = await readFile(path.resolve(vendored[1]));
      if (sha256(bytes) !== sha256(trustedBytes)) throw new Error(`La copia local de ${vendored[0]} no coincide con la dependencia auditada.`);
      continue;
    }
    if (path.extname(file).toLowerCase() === '.pdf') {
      if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error(`PDF inválido en ${relativePath}.`);
      const searchable = [
        execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }),
        execFileSync('pdfinfo', [file], { encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      ].join('\n');
      if (blocked.some((pattern) => pattern.test(searchable))) throw new Error(`Contenido sensible detectado en ${relativePath}.`);
      continue;
    }
    if (path.extname(file).toLowerCase() === '.svg') {
      const content = bytes.toString('utf8');
      if (!/<svg\b/i.test(content) || /<script\b|<foreignObject\b|href=["']https?:/i.test(content)) throw new Error(`SVG no permitido en ${relativePath}.`);
      if (blocked.some((pattern) => pattern.test(content))) throw new Error(`Contenido sensible detectado en ${relativePath}.`);
      continue;
    }
    if (path.extname(file).toLowerCase() === '.png') {
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`PNG inválido en ${path.relative(root, file)}.`);
      continue;
    }
    if (['.jpg', '.jpeg'].includes(path.extname(file).toLowerCase())) {
      if (bytes.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new Error(`JPEG inválido en ${path.relative(root, file)}.`);
      continue;
    }
    if (path.extname(file).toLowerCase() === '.otf') {
      if (bytes.subarray(0, 4).toString('ascii') !== 'OTTO') throw new Error(`OTF inválido en ${path.relative(root, file)}.`);
      continue;
    }
    if (path.extname(file).toLowerCase() === '.ttf') {
      if (bytes.subarray(0, 4).toString('hex') !== '00010000') throw new Error(`TTF inválido en ${path.relative(root, file)}.`);
      continue;
    }
    const content = bytes.toString('utf8');
    if (blocked.some((pattern) => pattern.test(content))) throw new Error(`Contenido sensible detectado en ${path.relative(root, file)}.`);
  }
  console.log(JSON.stringify({ status: 'dist-valid', files: files.length }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(target));
    else result.push(target);
  }
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
