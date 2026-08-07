import { spawn } from 'node:child_process';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';

const args = parseArgs();
const input = path.resolve(requireArg(args, 'input'));
const expectedTitle = args.title ? String(args.title) : null;
const expectedPages = args.pages ? Number(args.pages) : null;
const info = await stat(input);
if (info.size < 5000) throw new Error('El PDF es demasiado pequeño para ser un informe válido.');
const handle = await open(input, 'r');
const signature = Buffer.alloc(5);
await handle.read(signature, 0, 5, 0);
await handle.close();
if (signature.toString('ascii') !== '%PDF-') throw new Error('El archivo no tiene una firma PDF válida.');

const metadata = await pdfInfo(input);
const pages = Number(metadata.Pages);
const sizeMatch = String(metadata['Page size'] || '').match(/([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
if (!Number.isInteger(pages) || pages < 1) throw new Error('pdfinfo no reportó un número válido de páginas.');
if (expectedPages && pages !== expectedPages) throw new Error(`El PDF contiene ${pages} páginas; se esperaban ${expectedPages}.`);
if (!sizeMatch) throw new Error('pdfinfo no reportó el tamaño de página.');
const width = Number(sizeMatch[1]);
const height = Number(sizeMatch[2]);
if (Math.abs(width - 612) > 1 || Math.abs(height - 792) > 1) throw new Error(`El PDF no está en tamaño carta: ${width} × ${height} puntos.`);
if (String(metadata.Tagged).toLowerCase() !== 'yes') throw new Error('El PDF no está etiquetado para accesibilidad.');
if (expectedTitle && !String(metadata.Title || '').toLocaleLowerCase('es-MX').includes(expectedTitle.toLocaleLowerCase('es-MX'))) throw new Error(`El título PDF no coincide con "${expectedTitle}".`);
const extractedPages = await pdfText(input);
const blankPages = extractedPages.map((text, index) => ({ page: index + 1, characters: text.replace(/\s/g, '').length })).filter((item) => item.characters < 10);
if (extractedPages.length !== pages) throw new Error(`La extracción encontró ${extractedPages.length} páginas de texto; pdfinfo reportó ${pages}.`);
if (blankPages.length) throw new Error(`El PDF contiene páginas visualmente sospechosas o vacías: ${JSON.stringify(blankPages)}.`);

console.log(JSON.stringify({
  status: 'pdf-valid',
  input,
  bytes: info.size,
  pages,
  nonblank_pages: extractedPages.length,
  page_size_points: [width, height],
  tagged: metadata.Tagged,
  title: metadata.Title || ''
}, null, 2));

async function pdfInfo(filePath) {
  const child = spawn('pdfinfo', [filePath], { windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (exitCode !== 0) throw new Error(`pdfinfo falló: ${stderr.trim() || `código ${exitCode}`}.`);
  return Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}

async function pdfText(filePath) {
  const child = spawn('pdftotext', ['-layout', filePath, '-'], { windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (exitCode !== 0) throw new Error(`pdftotext falló: ${stderr.trim() || `código ${exitCode}`}.`);
  const pages = stdout.split('\f');
  if (!pages.at(-1)?.trim()) pages.pop();
  return pages;
}
