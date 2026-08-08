import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs, requireArg } from './lib/args.mjs';
import { assertValidContract, loadContract, loadPolicy, releaseId, sanitizePublicManifest } from './lib/contract.mjs';
import { renderModelReport, renderPortal, renderReport } from './lib/render.mjs';

const MODELO_EDITORIAL = {
  report_id: 'modelo-editorial-dgmesnie',
  slug: 'modelo-editorial',
  kind: 'Muestrario editorial',
  title: 'Informe modelo editorial',
  description: 'Plantilla local con repertorio de texto, KPIs, tablas, gráficas, mapas, figuras, referencias y contraportada.',
  status: 'modelo local · datos ilustrativos',
  cutoff: '2026-08-07',
  version: '1.0.0-modelo',
  latest_path: '/informes/modelo-editorial/',
  version_path: '/informes/modelo-editorial/'
};

let staging;
try {
  const args = parseArgs();
  const input = path.resolve(requireArg(args, 'input'));
  const output = path.resolve(args.output || 'dist');
  const baseUrl = new URL(requireArg(args, 'base-url'));
  if (baseUrl.protocol !== 'https:') throw new Error('--base-url debe usar HTTPS.');
  const { contract, raw } = await loadContract(input);
  const policy = await loadPolicy();
  assertValidContract(contract, policy, { mode: 'publish', raw });
  const manifest = sanitizePublicManifest(contract, baseUrl);
  const id = releaseId(contract);
  const existingVersionRoot = path.join(output, 'informes', contract.slug, 'versiones');
  const existingManifestPath = path.join(existingVersionRoot, id, 'manifest.json');
  const existingManifest = await readJsonIfPresent(existingManifestPath);
  if (existingManifest?.publisher_version === manifest.publisher_version) {
    if (existingManifest.content_sha256 !== manifest.content_sha256) {
      throw new Error(`Colisión inmutable: ${id} ya existe con otro hash. Incremente version.`);
    }
    if (args['refresh-shell']) {
      await refreshLocalShell(output, { contract, manifest, id, baseUrl });
      console.log(JSON.stringify({ status: 'shell-refreshed', output, release_id: id, content_sha256: manifest.content_sha256 }, null, 2));
      process.exit(0);
    }
    console.log(JSON.stringify({ status: 'no-op', output, release_id: id, content_sha256: manifest.content_sha256 }, null, 2));
    process.exit(0);
  }
  staging = path.join(path.dirname(output), `.publish-tmp-${randomUUID()}`);
  const latestDir = path.join(staging, 'informes', contract.slug);
  const versionDir = path.join(latestDir, 'versiones', id);
  await mkdir(path.join(staging, 'assets'), { recursive: true });
  // Se conserva el árbol completo de informes: publicar uno no puede borrar a
  // los demás ni su historial de ediciones inmutables.
  await cp(path.join(output, 'informes'), path.join(staging, 'informes'), { recursive: true }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await rm(latestDir, { recursive: true, force: true });
  await cp(existingVersionRoot, path.join(latestDir, 'versiones'), { recursive: true }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await mkdir(versionDir, { recursive: true });
  await cp(path.resolve('src/site/styles.css'), path.join(staging, 'assets', 'styles.css'));
  await cp(path.resolve('src/site/app.js'), path.join(staging, 'assets', 'app.js'));
  await cp(path.resolve('src/site/paginate.js'), path.join(staging, 'assets', 'paginate.js'));
  await cp(path.resolve('src/site/model.js'), path.join(staging, 'assets', 'model.js'));
  await cp(path.resolve('node_modules/echarts/dist/echarts.min.js'), path.join(staging, 'assets', 'echarts.min.js'));
  await cp(path.resolve('node_modules/qrcode-generator/dist/qrcode.js'), path.join(staging, 'assets', 'qrcode.js'));
  await cp(path.resolve('Sistema de Diseño/assets/logo_sener.png'), path.join(staging, 'assets', 'sener-logo.png'));
  await cp(path.resolve('Sistema de Diseño/assets/reno_portada.png'), path.join(staging, 'assets', 'reno-portada.png'));
  await cp(path.resolve('Sistema de Diseño/assets/reno_anexos.png'), path.join(staging, 'assets', 'reno-anexos.png'));
  await cp(path.resolve('Sistema de Diseño/assets/lema_margarita_2026.png'), path.join(staging, 'assets', 'lema-margarita-2026.png'));
  await cp(path.resolve('Sistema de Diseño/assets/mujer.png'), path.join(staging, 'assets', 'mujer.png'));
  await cp(path.resolve('Sistema de Diseño/assets/logo_gob.png'), path.join(staging, 'assets', 'gobierno-mexico-logo.png'));
  await cp(path.resolve('Sistema de Diseño/assets/gcr-data.js'), path.join(staging, 'assets', 'gcr-data.js'));
  await cp(path.resolve('Sistema de Diseño/assets/portada_marco_regulatorio_foto.jpg'), path.join(staging, 'assets', 'portada-marco-regulatorio.jpg'));
  await cp(path.resolve('Sistema de Diseño/assets/fonts'), path.join(staging, 'assets', 'fonts'), { recursive: true });
  await cp(path.resolve('src/site/favicon.svg'), path.join(staging, 'favicon.svg'));
  await writeFile(path.join(latestDir, 'index.html'), renderReport(contract, manifest, { baseUrl }));
  await writeFile(path.join(versionDir, 'index.html'), renderReport(contract, manifest, { immutable: true, baseUrl }));
  const modelDir = path.join(staging, 'informes', 'modelo-editorial');
  await mkdir(modelDir, { recursive: true });
  await writeFile(path.join(modelDir, 'index.html'), renderModelReport());
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(latestDir, 'manifest.json'), manifestText);
  await writeFile(path.join(versionDir, 'manifest.json'), manifestText);
  const catalog = await buildCatalog(staging, contract.cutoff);
  await writeFile(path.join(staging, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(path.join(staging, 'index.html'), renderPortal(catalog));
  await writeFile(path.join(staging, '_headers'), `/informes/*/versiones/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/informes/*\n  Cache-Control: no-cache\n\n/catalog.json\n  Cache-Control: no-cache\n`);

  const backup = `${output}.previous`;
  await rm(backup, { recursive: true, force: true });
  let hadOutput = false;
  try { await rename(output, backup); hadOutput = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    await rename(staging, output);
    staging = null;
    if (hadOutput) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadOutput) await rename(backup, output);
    throw error;
  }
  console.log(JSON.stringify({ status: 'built', output, latest: `/informes/${contract.slug}/`, immutable: `/informes/${contract.slug}/versiones/${id}/`, content_sha256: manifest.content_sha256 }, null, 2));
} catch (error) {
  if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
}

// El catálogo describe lo que realmente está publicado: se arma leyendo el
// manifiesto de cada informe del árbol, no una lista escrita a mano que habría
// que editar cada vez que se suma un informe.
async function buildCatalog(siteRoot, generatedOn) {
  const reportsRoot = path.join(siteRoot, 'informes');
  const entries = await readdir(reportsRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const reports = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'modelo-editorial') continue;
    const manifest = await readJsonIfPresent(path.join(reportsRoot, entry.name, 'manifest.json'));
    if (!manifest) continue;
    reports.push({
      report_id: manifest.report_id,
      slug: manifest.slug,
      kind: manifest.kind ?? 'Informe institucional',
      title: manifest.title,
      description: manifest.description ?? '',
      status: manifest.status,
      cutoff: manifest.cutoff,
      version: manifest.version,
      latest_path: `/informes/${manifest.slug}/`,
      version_path: `/informes/${manifest.slug}/versiones/${manifest.release_id}/`
    });
  }
  reports.sort((left, right) => String(right.cutoff).localeCompare(String(left.cutoff)) || left.slug.localeCompare(right.slug));
  return { schema_version: 1, generated_on: generatedOn, reports: [...reports, MODELO_EDITORIAL] };
}

async function readJsonIfPresent(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Refresco local de la cáscara: repite activos y vuelve a componer el HTML del
// informe sin tocar el manifiesto ni el hash de contenido de la edición.
async function refreshLocalShell(output, { contract, manifest, id, baseUrl } = {}) {
  const assetDir = path.join(output, 'assets');
  const modelDir = path.join(output, 'informes', 'modelo-editorial');
  await mkdir(assetDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });
  if (contract && manifest) {
    const reportDir = path.join(output, 'informes', contract.slug);
    await writeFile(path.join(reportDir, 'index.html'), renderReport(contract, manifest, { baseUrl }));
    await writeFile(path.join(reportDir, 'versiones', id, 'index.html'), renderReport(contract, manifest, { immutable: true, baseUrl }));
    await writeFile(path.join(output, 'index.html'), renderPortal(await buildCatalog(output, contract.cutoff)));
  }
  await cp(path.resolve('src/site/styles.css'), path.join(assetDir, 'styles.css'));
  await cp(path.resolve('src/site/app.js'), path.join(assetDir, 'app.js'));
  await cp(path.resolve('src/site/paginate.js'), path.join(assetDir, 'paginate.js'));
  await cp(path.resolve('src/site/model.js'), path.join(assetDir, 'model.js'));
  await cp(path.resolve('node_modules/echarts/dist/echarts.min.js'), path.join(assetDir, 'echarts.min.js'));
  await cp(path.resolve('node_modules/qrcode-generator/dist/qrcode.js'), path.join(assetDir, 'qrcode.js'));
  await cp(path.resolve('Sistema de Diseño/assets/portada_marco_regulatorio_foto.jpg'), path.join(assetDir, 'portada-marco-regulatorio.jpg'));
  await writeFile(path.join(modelDir, 'index.html'), renderModelReport());
}
