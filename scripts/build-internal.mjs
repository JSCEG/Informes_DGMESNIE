/*
 * Compone un informe de distribución interna.
 *
 * La salida no es un sitio: es el material del que se exporta el PDF que se
 * envía por correo a una lista nombrada. Se escribe siempre fuera del árbol
 * publicado, porque un informe interno puede llevar datos de contacto que no
 * deben quedar accesibles en la web.
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';
import { assertValidContract, loadContract, loadPolicy, releaseId, sanitizePublicManifest } from './lib/contract.mjs';
import { renderReport } from './lib/render.mjs';

try {
  const args = parseArgs();
  const input = path.resolve(requireArg(args, 'input'));
  const output = path.resolve(args.output || '.shadow/interno');
  // El destino queda acotado a .shadow/, igual que el borrador local: así una
  // ruta equivocada no puede depositar contactos dentro de dist/.
  const shadowRoot = path.resolve('.shadow');
  const relative = path.relative(shadowRoot, output);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('La salida interna sólo puede escribirse dentro de .shadow/.');

  const { contract, raw } = await loadContract(input);
  const policy = await loadPolicy();
  assertValidContract(contract, policy, { mode: 'publish', raw });
  if (contract.classification !== 'internal') throw new Error('Este publicador sólo compone informes con clasificación internal.');

  // La URL base sólo alimenta el canonical del documento; un informe interno no
  // se resuelve en internet, así que se marca como tal.
  const baseUrl = new URL('https://interno.dgmesnie.invalid');
  const manifest = sanitizePublicManifest(contract, baseUrl);
  const id = releaseId(contract);

  await rm(output, { recursive: true, force: true });
  const reportDir = path.join(output, 'informes', contract.slug);
  await mkdir(path.join(output, 'assets'), { recursive: true });
  await mkdir(reportDir, { recursive: true });

  for (const [from, to] of [
    ['src/site/styles.css', 'styles.css'],
    ['src/site/app.js', 'app.js'],
    ['src/site/paginate.js', 'paginate.js'],
    ['node_modules/qrcode-generator/dist/qrcode.js', 'qrcode.js'],
    ['Sistema de Diseño/assets/logo_sener.png', 'sener-logo.png'],
    ['Sistema de Diseño/assets/logo_gob.png', 'gobierno-mexico-logo.png'],
    ['Sistema de Diseño/assets/mujer.png', 'mujer.png'],
    ['Sistema de Diseño/assets/lema_margarita_2026.png', 'lema-margarita-2026.png'],
    ['Sistema de Diseño/assets/reno_portada.png', 'reno-portada.png'],
    ['Sistema de Diseño/assets/portada_marco_regulatorio_foto.jpg', 'portada-marco-regulatorio.jpg']
  ]) {
    await cp(path.resolve(from), path.join(output, 'assets', to));
  }
  await cp(path.resolve('Sistema de Diseño/assets/fonts'), path.join(output, 'assets', 'fonts'), { recursive: true });
  await cp(path.resolve('src/site/favicon.svg'), path.join(output, 'favicon.svg'));

  await writeFile(path.join(reportDir, 'index.html'), renderReport(contract, manifest, { baseUrl }));
  await writeFile(path.join(reportDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // Un índice mínimo evita que el exportador falle al comprobar la raíz.
  await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Distribución interna</title></head><body><p>Material de distribución interna. No publicar.</p></body></html>');
  await writeFile(path.join(output, 'NO-PUBLICAR.txt'), 'Este árbol contiene un informe de distribución interna con datos de contacto.\nNo debe copiarse a dist/ ni desplegarse en el sitio público.\n');

  console.log(JSON.stringify({
    status: 'internal-built',
    output,
    route: `/informes/${contract.slug}/`,
    release_id: id,
    content_sha256: manifest.content_sha256
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
