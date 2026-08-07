import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFNull, PDFNumber } from 'pdf-lib';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const root = path.resolve(args.root || 'dist');
const route = String(args.route || '/informes/modelo-editorial/');
const requestedOutput = path.resolve(args.output || 'output/pdf/modelo-editorial.pdf');
const publicOutput = args['public-output'] ? path.resolve(String(args['public-output'])) : null;
const port = Number(args.port || 4199);
const expectedTitle = String(args.title || 'Informe modelo editorial');
// El auditor conserva una ruta fija aunque el PDF lleve corte y versión, para
// que la validación posterior sepa qué archivo produjo la corrida.
const auditPath = requestedOutput.replace(/\.pdf$/i, '.audit.json');
// Con --versioned cada corrida deja su propio archivo y no pisa la anterior.
const output = args.versioned
  ? requestedOutput.replace(/\.pdf$/i, `-${await releaseSuffix(root, route)}.pdf`)
  : requestedOutput;

if (!route.startsWith('/') || route.includes('..') || route.includes('\\')) throw new Error('--route debe ser una ruta pública absoluta y segura.');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port debe ser un puerto local válido.');
await stat(path.join(root, 'index.html'));
await mkdir(path.dirname(output), { recursive: true });
const temporaryOutput = `${output}.tmp.pdf`;
await rm(temporaryOutput, { force: true });

const server = spawn(process.execPath, ['scripts/serve.mjs', '--root', root, '--port', String(port)], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

let browser;
try {
  const origin = `http://127.0.0.1:${port}`;
  await waitForServer(`${origin}/`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-MX' });
  const localFailures = [];
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => { if (request.url().startsWith(origin)) localFailures.push(`${request.method()} ${request.url()}`); });
  await page.route('**/*', async (requestRoute) => {
    if (requestRoute.request().url().startsWith(origin)) await requestRoute.continue();
    else await requestRoute.abort('blockedbyclient');
  });

  const url = new URL(route, origin).href;
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`No fue posible abrir ${url}: HTTP ${response?.status() ?? 'sin respuesta'}.`);
  await page.evaluate(() => document.fonts.ready);
  // La composición por hojas se mide en el navegador: sin esperarla el PDF
  // saldría del flujo continuo, sin folios ni cortes de hoja.
  await page.evaluate(() => window.reportReady ?? null);
  await page.waitForFunction(() => [...document.querySelectorAll('.interactive-chart')].every((element) => element.querySelector('svg')), null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__pdfExporting = true;
    window.prepareReportPrint?.({ clone: false });
  });
  await page.waitForTimeout(650);
  await page.evaluate(() => window.prepareReportPrint?.());
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print', colorScheme: 'light', reducedMotion: 'reduce' });

  const layout = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('#pdf-print-root > .reader-page')];
    const overflow = pages.map((page, index) => {
      const bounds = page.getBoundingClientRect();
      // Sólo cuenta lo que puede verse fuera de la hoja. Se descartan las
      // alternativas para lectores de pantalla y todo lo que ya recorta un
      // contenedor propio: su caja real no llega al papel.
      const clipped = (element) => {
        for (let node = element.parentElement; node && node !== page; node = node.parentElement) {
          const styles = getComputedStyle(node);
          if (styles.overflowX !== 'visible' || styles.overflowY !== 'visible') return true;
        }
        return false;
      };
      const descendants = [...page.querySelectorAll('*')].filter((element) => {
        const styles = getComputedStyle(element);
        if (styles.display === 'none' || styles.visibility === 'hidden') return false;
        if (element.closest('.sr-only')) return false;
        return !clipped(element);
      });
      const right = Math.max(bounds.right, ...descendants.map((element) => element.getBoundingClientRect().right));
      const bottom = Math.max(bounds.bottom, ...descendants.map((element) => element.getBoundingClientRect().bottom));
      return {
        page: index + 1,
        overflow_x: Math.max(0, Math.ceil(right - bounds.right)),
        overflow_y: Math.max(0, Math.ceil(bottom - bounds.bottom))
      };
    }).filter((item) => item.overflow_x > 1 || item.overflow_y > 1);
    // Aprovechamiento real de la caja: una hoja de texto a medio llenar es un
    // defecto de composición, no una decisión editorial.
    const underfilled = pages.map((page, index) => {
      if (!page.classList.contains('paginated-sheet')) return null;
      const body = page.querySelector('.section-body');
      if (!body) return null;
      const children = [...body.children].filter((child) => !child.classList.contains('page-folio'));
      if (!children.length) return null;
      const styles = getComputedStyle(body);
      const bounds = body.getBoundingClientRect();
      const top = bounds.top + parseFloat(styles.paddingTop);
      const usable = bounds.bottom - parseFloat(styles.paddingBottom) - top;
      const used = children[children.length - 1].getBoundingClientRect().bottom - top;
      const fill = usable > 0 ? used / usable : 1;
      // Una hoja sólo puede llenarse con lo que viene después si lo que sigue
      // es otra hoja compuesta: una apertura o un diagrama ocupan hoja propia.
      const next = pages[index + 1];
      const closesRun = !next || !next.classList.contains('paginated-sheet');
      return closesRun ? null : { page: index + 1, fill: Number(fill.toFixed(2)) };
    }).filter((item) => item && item.fill < 0.6);
    return {
      title: document.title,
      page_count: pages.length,
      overflow,
      underfilled,
      pagination: window.reportPaginationReport ?? null,
      charts: document.querySelectorAll('#pdf-print-root .interactive-chart svg').length,
      maps: document.querySelectorAll('#pdf-print-root .interactive-map svg').length,
      fonts_loaded: document.fonts.check('16px Patria') && document.fonts.check('16px "Noto Sans"')
    };
  });
  if (!layout.page_count) throw new Error('El documento no contiene hojas exportables.');
  if (layout.overflow.length) throw new Error(`La exportación se bloqueó por desbordamiento: ${JSON.stringify(layout.overflow)}.`);
  if (layout.pagination?.oversized?.length) throw new Error(`Bloques que no caben en una hoja: ${JSON.stringify(layout.pagination.oversized)}.`);
  if (layout.underfilled.length) throw new Error(`Hojas interiores a menos del 60 % de la caja: ${JSON.stringify(layout.underfilled)}.`);
  if (!layout.fonts_loaded) throw new Error('Las tipografías no terminaron de cargar.');
  if (!layout.title.toLocaleLowerCase('es-MX').includes(expectedTitle.toLocaleLowerCase('es-MX'))) throw new Error(`El título del documento no coincide con "${expectedTitle}".`);
  if (localFailures.length) throw new Error(`Fallaron recursos locales: ${localFailures.join(', ')}.`);
  if (consoleErrors.length) throw new Error(`La página produjo errores de consola: ${consoleErrors.join(' | ')}.`);

  // El navegador descarta los enlaces de fragmento al imprimir: no genera
  // destino ni anotación. Se recoge la geometría de cada ancla interna para
  // reconstruirla como salto real dentro del PDF.
  const internalLinks = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('#pdf-print-root > .reader-page')];
    const sheetOf = (element) => sheets.indexOf(element.closest('.reader-page'));
    const links = [];
    for (const [index, sheet] of sheets.entries()) {
      for (const anchor of sheet.querySelectorAll('a[href^="#"]')) {
        const id = decodeURIComponent(anchor.getAttribute('href').slice(1));
        if (!id) continue;
        const target = document.querySelector(`#pdf-print-root [id="${CSS.escape(id)}"]`);
        if (!target) continue;
        const targetSheet = sheetOf(target);
        if (targetSheet < 0 || targetSheet === index) continue;
        const sheetBounds = sheet.getBoundingClientRect();
        const bounds = anchor.getBoundingClientRect();
        if (bounds.width < 1 || bounds.height < 1) continue;
        const targetBounds = target.getBoundingClientRect();
        const targetSheetBounds = sheets[targetSheet].getBoundingClientRect();
        // El folio impreso en el índice permite comprobar que el salto lleva
        // exactamente a la hoja anunciada.
        const printed = anchor.closest('.report-toc') ? anchor.querySelector('em')?.textContent?.trim() : null;
        links.push({
          id,
          fromPage: index,
          toPage: targetSheet,
          printedFolio: printed && /^\d+$/.test(printed) ? Number(printed) : null,
          left: bounds.left - sheetBounds.left,
          top: bounds.top - sheetBounds.top,
          width: bounds.width,
          height: bounds.height,
          targetTop: Math.max(0, targetBounds.top - targetSheetBounds.top),
          sheetWidth: sheetBounds.width,
          sheetHeight: sheetBounds.height
        });
      }
    }
    return links;
  });

  await page.pdf({
    path: temporaryOutput,
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
    outline: true,
    displayHeaderFooter: false
  });
  // Un índice que anuncia una hoja y salta a otra es peor que uno sin enlaces.
  const misdirected = internalLinks
    .filter((link) => link.printedFolio !== null && link.printedFolio !== link.toPage + 1)
    .map((link) => ({ id: link.id, anuncia: link.printedFolio, salta_a: link.toPage + 1 }));
  if (misdirected.length) throw new Error(`El índice anuncia hojas que no coinciden con su destino: ${JSON.stringify(misdirected.slice(0, 8))}.`);
  const tocLinks = internalLinks.filter((link) => link.printedFolio !== null).length;

  const navigation = { ...await addInternalLinks(temporaryOutput, internalLinks), toc_links: tocLinks };
  await rename(temporaryOutput, output);
  if (publicOutput) {
    await mkdir(path.dirname(publicOutput), { recursive: true });
    await copyFile(output, publicOutput);
  }
  await writeFile(auditPath, `${JSON.stringify({
    status: 'pdf-exported',
    route,
    output,
    public_output: publicOutput,
    ...layout,
    navigation
  }, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'pdf-exported', output, public_output: publicOutput, ...layout, navigation }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  await rm(temporaryOutput, { force: true }).catch(() => {});
}

// Reconstruye cada ancla interna como anotación /Link con acción /GoTo. Las
// coordenadas del navegador van en píxeles CSS desde la esquina superior
// izquierda; el PDF las mide en puntos desde la inferior.
async function addInternalLinks(filePath, links) {
  if (!links.length) return { internal_links: 0, skipped: 0 };
  const document = await PDFDocument.load(await readFile(filePath));
  const pages = document.getPages();
  let added = 0;
  let skipped = 0;
  for (const link of links) {
    const source = pages[link.fromPage];
    const target = pages[link.toPage];
    if (!source || !target) {
      skipped += 1;
      continue;
    }
    const { width: pointWidth, height: pointHeight } = source.getSize();
    const scaleX = pointWidth / link.sheetWidth;
    const scaleY = pointHeight / link.sheetHeight;
    const left = link.left * scaleX;
    const right = (link.left + link.width) * scaleX;
    const bottom = pointHeight - (link.top + link.height) * scaleY;
    const top = pointHeight - link.top * scaleY;
    const destinationY = target.getSize().height - link.targetTop * scaleY;
    const annotation = document.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [left, bottom, right, top],
      Border: [0, 0, 0],
      F: 4,
      A: document.context.obj({
        S: 'GoTo',
        D: [target.ref, PDFName.of('XYZ'), PDFNull, PDFNumber.of(destinationY), PDFNull]
      })
    });
    // addAnnot crea el arreglo /Annots cuando la hoja aún no tiene ninguno.
    source.node.addAnnot(document.context.register(annotation));
    added += 1;
  }
  await writeFile(filePath, await document.save());
  return { internal_links: added, skipped };
}

// El identificador de edición del manifiesto ya combina corte y versión, y es
// el mismo que nombra la ruta inmutable del sitio.
async function releaseSuffix(siteRoot, reportRoute) {
  const manifestPath = path.join(siteRoot, reportRoute.replace(/^\/+/, ''), 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const release = String(manifest.release_id ?? '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(release)) throw new Error(`El manifiesto no declara un release_id utilizable: "${release}".`);
  return release;
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`El servidor local terminó con código ${server.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`El servidor local no respondió en ${url}.`);
}
