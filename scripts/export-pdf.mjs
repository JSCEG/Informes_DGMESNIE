import { spawn } from 'node:child_process';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const root = path.resolve(args.root || 'dist');
const route = String(args.route || '/informes/modelo-editorial/');
const output = path.resolve(args.output || 'output/pdf/modelo-editorial.pdf');
const publicOutput = args['public-output'] ? path.resolve(String(args['public-output'])) : null;
const port = Number(args.port || 4199);
const expectedTitle = String(args.title || 'Informe modelo editorial');
const auditPath = output.replace(/\.pdf$/i, '.audit.json');

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

  await page.pdf({
    path: temporaryOutput,
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
    outline: true,
    displayHeaderFooter: false
  });
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
    ...layout
  }, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'pdf-exported', output, public_output: publicOutput, ...layout }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  await rm(temporaryOutput, { force: true }).catch(() => {});
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
