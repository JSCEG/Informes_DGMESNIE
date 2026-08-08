import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';
import { adaptMarkdown } from './lib/markdown.mjs';

try {
  const args = parseArgs();
  const source = path.resolve(requireArg(args, 'source'));
  const output = path.resolve(args.output || '.shadow/radar-regulatorio.candidate.json');
  const markdown = await readFile(source, 'utf8');
  const adapted = adaptMarkdown(markdown, { sourceName: path.basename(source) });
  const now = new Date().toISOString();
  // Versión y corte salen del frontmatter del resultado canónico; los
  // argumentos sólo se usan para forzar una corrida fuera de ese flujo.
  const version = String(args.version || adapted.semver || '0.1.0-candidate');
  const cutoff = String(args.cutoff || adapted.isoDate || now.slice(0, 10));
  if (!args.version && !adapted.semver) console.error('Aviso: el documento no declara una versión utilizable en su frontmatter.');
  if (!args.cutoff && !adapted.isoDate) console.error('Aviso: el documento no declara una fecha de corte utilizable en su frontmatter.');
  const contract = {
    schema_version: 1,
    report_id: 'radar-regulatorio-energ-tico-dgmesnie',
    slug: 'radar-regulatorio-energetico',
    title: adapted.title,
    subtitle: adapted.subtitle,
    description: adapted.subtitle || 'Marco y panorama regulatorio del sector energético mexicano.',
    kind: 'Radar regulatorio',
    running_title: 'Marco regulatorio energético',
    cover: { variant: 'ribbon', photo: '/assets/portada-marco-regulatorio.jpg' },
    version,
    cutoff,
    published_at: null,
    status: 'candidato shadow',
    classification: 'public-candidate',
    publication_approved: false,
    content_notice: 'Candidato generado en modo shadow a partir del resultado canónico. Requiere revisión editorial y autorización explícita antes de cualquier despliegue.',
    summary: adapted.subtitle || 'Pendiente de revisión editorial y clasificación explícita.',
    highlights: [
      { label: 'Corte', value: cutoff, detail: 'Fecha documental del resultado canónico' },
      { label: 'Fuente', value: 'Canónica', detail: adapted.sourceVersion ? `Versión documental ${adapted.sourceVersion}` : 'Pipeline vigente' },
      { label: 'Entrega', value: 'Shadow', detail: 'Sin cambios en correo o PDF' }
    ],
    sections: adapted.sections,
    sources: adapted.sources,
    optional_pdf: null,
    review: null,
    _private: { ...adapted.privateProvenance, source_path: source, adapted_at: now }
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`, { flag: 'wx' }).catch(async (error) => {
    if (error.code !== 'EEXIST' || !args.overwrite) throw error;
    await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`);
  });
  console.log(JSON.stringify({ status: 'shadow-candidate', output, sections: contract.sections.length, sources: contract.sources.length, source_sha256: adapted.privateProvenance.source_sha256 }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
