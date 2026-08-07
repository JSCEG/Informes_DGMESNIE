import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from './lib/args.mjs';

const args = parseArgs();
const root = path.resolve(args.root || 'dist');
const port = Number(args.port || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.otf': 'font/otf', '.ttf': 'font/ttf' };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const decoded = decodeURIComponent(url.pathname);
    let file = path.resolve(root, `.${decoded}`);
    if (!file.startsWith(`${root}${path.sep}`) && file !== root) throw new Error('Ruta fuera del sitio.');
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = path.join(file, 'index.html');
    const finalInfo = await stat(file);
    if (!finalInfo.isFile()) throw new Error('No encontrado.');
    // Servidor de revisión: nunca debe entregar una versión anterior de la
    // hoja de estilos o del paginador tras reconstruir el sitio.
    response.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store, must-revalidate'
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('No encontrado');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Portal local: http://127.0.0.1:${port}/`));
