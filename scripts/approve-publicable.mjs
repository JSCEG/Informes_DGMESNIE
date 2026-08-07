import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';
import { assertValidContract, canonicalJson, loadContract, loadPolicy } from './lib/contract.mjs';

try {
  const args = parseArgs();
  if (args['confirm-public'] !== true) throw new Error('Se requiere --confirm-public para aprobar una edición.');
  const input = path.resolve(requireArg(args, 'input'));
  const output = path.resolve(requireArg(args, 'output'));
  const reviewer = requireArg(args, 'reviewer');
  const localDraft = args['local-draft'] === true;
  if (localDraft) {
    const shadowRoot = path.resolve('.shadow');
    const relativeOutput = path.relative(shadowRoot, output);
    if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('--local-draft sólo puede escribir dentro de .shadow/.');
  }
  const { contract } = await loadContract(input);
  if (contract.classification !== 'public-candidate' || contract.publication_approved !== false) throw new Error('El archivo de entrada no es un candidato shadow esperado.');
  const { _private, ...publicFields } = contract;
  const stamp = new Date().toISOString();
  const approved = {
    ...publicFields,
    classification: 'public',
    publication_approved: true,
    publication_scope: localDraft ? 'local-only' : 'public-release',
    published_at: stamp,
    status: localDraft ? 'borrador local — no publicado' : 'publicación aprobada',
    content_notice: localDraft ? 'Borrador web local generado del resultado canónico real. Superó controles técnicos de contenido publicable, pero no ha sido desplegado ni enviado.' : publicFields.content_notice,
    review: { approved_by: reviewer, approved_at: stamp, basis: localDraft ? 'Autorización del usuario para generar un borrador web exclusivamente local; no autoriza despliegue.' : 'Revisión editorial y confirmación explícita de difusión pública' }
  };

  // Volver a aprobar el mismo contenido no es una edición nueva. Sin esto, el
  // reloj cambia el hash en cada corrida y el guardián de inmutabilidad rechaza
  // la publicación aunque el documento sea idéntico: una tarea diaria fallaría
  // desde su segunda ejecución.
  const previous = await readJsonIfPresent(output);
  if (previous && sameContent(previous, approved)) {
    approved.published_at = previous.published_at ?? approved.published_at;
    if (previous.review?.approved_at) approved.review.approved_at = previous.review.approved_at;
  }
  const policy = await loadPolicy();
  const raw = JSON.stringify(approved, null, 2);
  assertValidContract(approved, policy, { mode: 'publish', raw });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${raw}\n`, { flag: 'wx' }).catch(async (error) => {
    if (error.code !== 'EEXIST' || !localDraft || args.overwrite !== true) throw error;
    await writeFile(output, `${raw}\n`);
  });
  console.log(JSON.stringify({
    status: 'approved',
    output,
    private_fields_removed: Boolean(_private),
    unchanged: approved.published_at !== stamp
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

// Compara el documento sin los sellos de aprobación: lo que decide si hay una
// edición nueva es el contenido, no la hora en que se ejecutó la corrida.
function sameContent(left, right) {
  const strip = ({ published_at: _published, review, ...rest }) => ({
    ...rest,
    review: review ? { ...review, approved_at: null } : review
  });
  return canonicalJson(strip(left)) === canonicalJson(strip(right));
}

async function readJsonIfPresent(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
