import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';

try {
  const args = parseArgs();
  const input = path.resolve(requireArg(args, 'input'));
  const assetId = requireArg(args, 'asset-id');
  const output = path.resolve(requireArg(args, 'output'));
  const lines = (await readFile(input, 'utf8')).split(/\r?\n/);
  let asset;
  for (const line of lines) {
    if (!line.startsWith('{') || !line.includes(assetId)) continue;
    try { asset = JSON.parse(line)[assetId]; } catch { /* no es el mapa de activos */ }
    if (asset) break;
  }
  if (!asset || asset.mime !== 'image/png' || typeof asset.data !== 'string') throw new Error('No se encontró el activo PNG solicitado.');
  const bytes = Buffer.from(asset.data, 'base64');
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('El activo no contiene una firma PNG válida.');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes);
  console.log(JSON.stringify({ status: 'extracted', output, mime: asset.mime, bytes: bytes.length }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
