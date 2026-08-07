import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';
import { assertValidContract, loadContract, loadPolicy } from './lib/contract.mjs';

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
  const approved = {
    ...publicFields,
    classification: 'public',
    publication_approved: true,
    publication_scope: localDraft ? 'local-only' : 'public-release',
    published_at: new Date().toISOString(),
    status: localDraft ? 'borrador local — no publicado' : 'publicación aprobada',
    content_notice: localDraft ? 'Borrador web local generado del resultado canónico real. Superó controles técnicos de contenido publicable, pero no ha sido desplegado ni enviado.' : publicFields.content_notice,
    review: { approved_by: reviewer, approved_at: new Date().toISOString(), basis: localDraft ? 'Autorización del usuario para generar un borrador web exclusivamente local; no autoriza despliegue.' : 'Revisión editorial y confirmación explícita de difusión pública' }
  };
  const policy = await loadPolicy();
  const raw = JSON.stringify(approved, null, 2);
  assertValidContract(approved, policy, { mode: 'publish', raw });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${raw}\n`, { flag: 'wx' }).catch(async (error) => {
    if (error.code !== 'EEXIST' || !localDraft || args.overwrite !== true) throw error;
    await writeFile(output, `${raw}\n`);
  });
  console.log(JSON.stringify({ status: 'approved', output, private_fields_removed: Boolean(_private) }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
