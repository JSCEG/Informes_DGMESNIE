/*
 * Extrae la fotografía incrustada en el arte autorizado de portada y la deja en
 * una resolución adecuada para una hoja carta.
 *
 * El SVG original guarda un JPEG de 6554 × 4372 px: pesa 9.2 MB de los 10 MB del
 * archivo y multiplica por diez el tamaño del PDF sin ganar detalle imprimible.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseArgs, requireArg } from './lib/args.mjs';

try {
  const args = parseArgs();
  const input = path.resolve(requireArg(args, 'input'));
  const output = path.resolve(requireArg(args, 'output'));
  const targetWidth = Number(args.width || 1700);
  const quality = Number(args.quality || 0.82);
  if (!Number.isInteger(targetWidth) || targetWidth < 200 || targetWidth > 6000) throw new Error('--width debe estar entre 200 y 6000 px.');
  if (!(quality > 0 && quality <= 1)) throw new Error('--quality debe estar entre 0 y 1.');

  const svg = await readFile(input, 'utf8');
  const candidates = [...svg.matchAll(/(?:xlink:)?href="(data:image\/(?:jpeg|png);base64,[^"]+)"/g)].map((match) => match[1]);
  if (!candidates.length) throw new Error('El SVG no contiene imágenes incrustadas.');
  const source = candidates.reduce((largest, item) => (item.length > largest.length ? item : largest));

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const encoded = await page.evaluate(async ({ source: dataUrl, targetWidth: width, quality: q }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const scale = Math.min(1, width / image.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL('image/jpeg', q).split(',')[1], width: canvas.width, height: canvas.height };
    }, { source, targetWidth, quality });
    const bytes = Buffer.from(encoded.data, 'base64');
    if (bytes.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new Error('La conversión no produjo un JPEG válido.');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, bytes);
    console.log(JSON.stringify({ status: 'cover-photo-extracted', output, width: encoded.width, height: encoded.height, bytes: bytes.length }, null, 2));
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
