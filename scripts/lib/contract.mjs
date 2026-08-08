import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\s"']+/;
// Los datos de contacto sólo se admiten en informes de distribución interna, que
// nunca llegan al sitio público. Todo lo demás queda bloqueado siempre.
const CONTACT_RULES = new Set(['correo electrónico']);
const SENSITIVE_TEXT = [
  { label: 'ruta local', pattern: WINDOWS_PATH },
  { label: 'ruta file://', pattern: /file:\/\//i },
  { label: 'correo electrónico', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: 'SharePoint/OneDrive', pattern: /(?:sharepoint\.com|onedrive(?:\.live)?\.com)/i },
  { label: 'token SendGrid', pattern: /\bSG\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/ },
  { label: 'llave privada', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'script incrustado', pattern: /<\/?script\b/i },
  { label: 'URL javascript', pattern: /javascript\s*:/i },
  { label: 'servidor local', pattern: /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i }
];

export async function loadPolicy(policyPath = path.resolve('config/publication-policy.json')) {
  return JSON.parse(await readFile(policyPath, 'utf8'));
}

export async function loadContract(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return { contract: JSON.parse(raw), raw };
}

export function releaseId(contract) {
  return `${contract.cutoff}-v${contract.version}`;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function validateContract(contract, policy, { mode = 'publish', raw = JSON.stringify(contract) } = {}) {
  const errors = [];
  const requiredStrings = ['report_id', 'slug', 'title', 'version', 'cutoff', 'status', 'classification'];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return ['El contrato debe ser un objeto JSON.'];
  }
  if (Buffer.byteLength(raw, 'utf8') > policy.max_contract_bytes) errors.push('El contrato excede el tamaño máximo permitido.');
  if (contract.schema_version !== policy.schema_version) errors.push('schema_version no es compatible con la política.');
  for (const field of requiredStrings) {
    if (typeof contract[field] !== 'string' || !contract[field].trim()) errors.push(`${field} es obligatorio.`);
  }
  if (!policy.allowed_report_ids.includes(contract.report_id)) errors.push('report_id no está permitido.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.slug ?? '')) errors.push('slug debe usar minúsculas, números y guiones.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contract.cutoff ?? '') || Number.isNaN(Date.parse(`${contract.cutoff}T00:00:00Z`))) errors.push('cutoff debe ser una fecha ISO válida YYYY-MM-DD.');
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(contract.version ?? '')) errors.push('version debe usar semver.');
  if (contract.published_at && Number.isNaN(Date.parse(contract.published_at))) errors.push('published_at debe ser ISO-8601 válido.');
  // Identidad editorial: lo que antes estaba escrito a mano en el renderizador
  // ahora lo declara cada informe y el gate lo valida.
  if (contract.kind !== undefined && (typeof contract.kind !== 'string' || !contract.kind.trim())) errors.push('kind debe ser un texto no vacío.');
  if (contract.running_title !== undefined && (typeof contract.running_title !== 'string' || !contract.running_title.trim())) errors.push('running_title debe ser un texto no vacío.');
  if (contract.cover !== undefined) {
    const cover = contract.cover;
    if (!cover || typeof cover !== 'object' || Array.isArray(cover)) errors.push('cover debe ser un objeto.');
    else {
      const variants = policy.allowed_cover_variants ?? ['ribbon'];
      if (cover.variant !== undefined && !variants.includes(cover.variant)) errors.push(`cover.variant no está permitido: ${cover.variant}.`);
      for (const field of ['photo', 'photo_alt']) {
        if (cover[field] !== undefined && typeof cover[field] !== 'string') errors.push(`cover.${field} debe ser un texto.`);
      }
      // Un activo de portada sólo puede venir del propio sitio.
      if (typeof cover.photo === 'string' && !/^\/assets\/[A-Za-z0-9._/-]+$/.test(cover.photo)) errors.push('cover.photo debe ser una ruta local bajo /assets/.');
    }
  }
  if (!Array.isArray(contract.sections) || contract.sections.length === 0) errors.push('sections debe incluir al menos una sección.');
  if ((contract.sections?.length ?? 0) > policy.max_sections) errors.push('El contrato excede el máximo de secciones.');
  if (!Array.isArray(contract.sources)) errors.push('sources debe ser una lista.');
  if ((contract.sources?.length ?? 0) > policy.max_sources) errors.push('El contrato excede el máximo de fuentes.');

  // Un informe interno se distribuye por correo a una lista nombrada y nunca se
  // publica en el sitio. Es la única figura que admite datos de contacto, y a
  // cambio queda excluida de la publicación web por el propio publicador.
  const isInternal = contract.classification === 'internal';
  if (isInternal) {
    if (!(policy.internal_report_ids ?? []).includes(contract.report_id)) errors.push('Este informe no está autorizado como interno en la política.');
    if (contract.publication_scope !== 'internal-distribution') errors.push('Un informe interno debe declarar publication_scope internal-distribution.');
  }

  if (mode === 'publish') {
    if (!isInternal && contract.classification !== 'public') errors.push('La clasificación debe ser public o internal.');
    if (contract.publication_approved !== true) errors.push('publication_approved debe ser true.');
    if (!contract.review || typeof contract.review.approved_by !== 'string' || !contract.review.approved_by.trim()) errors.push('Falta la aprobación editorial.');
  }

  const sectionIds = new Set();
  for (const [sectionIndex, section] of (contract.sections ?? []).entries()) {
    if (!section || typeof section !== 'object') {
      errors.push(`sections[${sectionIndex}] no es válido.`);
      continue;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(section.id ?? '')) errors.push(`sections[${sectionIndex}].id no es válido.`);
    if (sectionIds.has(section.id)) errors.push(`La sección ${section.id} está duplicada.`);
    sectionIds.add(section.id);
    if (typeof section.title !== 'string' || !section.title.trim()) errors.push(`sections[${sectionIndex}].title es obligatorio.`);
    if (!Array.isArray(section.blocks)) errors.push(`sections[${sectionIndex}].blocks debe ser una lista.`);
    for (const [blockIndex, block] of (section.blocks ?? []).entries()) {
      if (!policy.allowed_block_types.includes(block?.type)) errors.push(`Bloque no permitido en sections[${sectionIndex}].blocks[${blockIndex}].`);
      if (block?.type === 'table' && (!Array.isArray(block.headers) || !Array.isArray(block.rows))) errors.push(`La tabla ${sectionIndex}:${blockIndex} no tiene headers/rows válidos.`);
      if (block?.type === 'flow' && (!Array.isArray(block.nodes) || !block.nodes.length || !Array.isArray(block.edges) || !block.edges.length)) errors.push(`El diagrama ${sectionIndex}:${blockIndex} no tiene nodes/edges válidos.`);
    }
  }

  for (const [sourceIndex, source] of (contract.sources ?? []).entries()) {
    if (!source || typeof source.label !== 'string' || typeof source.url !== 'string') {
      errors.push(`sources[${sourceIndex}] requiere label y url.`);
      continue;
    }
    errors.push(...urlErrors(source.url, policy, `sources[${sourceIndex}]`));
  }

  walk(contract, [], (value, keys) => {
    const key = keys.at(-1);
    if (policy.forbidden_field_names.includes(key)) errors.push(`Campo prohibido: ${keys.join('.')}.`);
    if (typeof value === 'string') {
      for (const rule of SENSITIVE_TEXT) {
        if (isInternal && CONTACT_RULES.has(rule.label)) continue;
        if (rule.pattern.test(value)) errors.push(`Contenido bloqueado (${rule.label}) en ${keys.join('.') || 'raíz'}.`);
      }
      return;
    }
    // Texto enriquecido: cada enlace en línea pasa por el mismo control de
    // origen que una fuente, y el texto plano debe coincidir con sus fragmentos.
    if (!value || typeof value !== 'object' || !Array.isArray(value.runs)) return;
    const location = keys.join('.') || 'raíz';
    if (typeof value.text !== 'string') {
      errors.push(`${location} declara runs sin texto plano.`);
      return;
    }
    for (const [runIndex, run] of value.runs.entries()) {
      if (!run || typeof run.t !== 'string') {
        errors.push(`${location}.runs[${runIndex}] no es un fragmento válido.`);
        continue;
      }
      if (run.u === undefined) continue;
      if (typeof run.u !== 'string') {
        errors.push(`${location}.runs[${runIndex}] tiene un enlace no textual.`);
        continue;
      }
      errors.push(...urlErrors(run.u, policy, `${location}.runs[${runIndex}]`));
    }
    if (value.runs.map((run) => (typeof run?.t === 'string' ? run.t : '')).join('') !== value.text) {
      errors.push(`${location} no reproduce su texto plano a partir de los fragmentos.`);
    }
  });

  return [...new Set(errors)];
}

function urlErrors(url, policy, location) {
  try {
    const parsed = new URL(url);
    const errors = [];
    if (parsed.protocol !== 'https:') errors.push(`${location} no usa HTTPS.`);
    if (!policy.allowed_source_hosts.includes(parsed.hostname.toLowerCase())) errors.push(`${location} usa un dominio no permitido.`);
    if (parsed.username || parsed.password) errors.push(`${location} contiene credenciales.`);
    return errors;
  } catch {
    return [`${location} no contiene una URL válida.`];
  }
}

function walk(value, keys, visitor) {
  visitor(value, keys);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...keys, String(index)], visitor));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, [...keys, key], visitor));
}

export function assertValidContract(contract, policy, options) {
  const errors = validateContract(contract, policy, options);
  if (errors.length) throw new Error(`Publicación bloqueada:\n- ${errors.join('\n- ')}`);
}

export function sanitizePublicManifest(contract, baseUrl) {
  const id = releaseId(contract);
  const reportPath = `/informes/${contract.slug}/`;
  const versionPath = `${reportPath}versiones/${id}/`;
  const sourceHosts = [...new Set(contract.sources.map(({ url }) => new URL(url).hostname))].sort();
  return {
    schema_version: 1,
    publisher_version: '2.4.6',
    report_id: contract.report_id,
    slug: contract.slug,
    title: contract.title,
    // El catálogo se arma leyendo los manifiestos publicados, así que cada uno
    // debe bastarse para describir su informe.
    kind: contract.kind ?? 'Informe institucional',
    description: contract.description ?? contract.summary ?? '',
    status: contract.status,
    cutoff: contract.cutoff,
    version: contract.version,
    release_id: id,
    published_at: contract.published_at ?? null,
    content_sha256: contentHash(contract),
    latest_url: new URL(reportPath, baseUrl).href,
    version_url: new URL(versionPath, baseUrl).href,
    source_count: contract.sources.length,
    source_hosts: sourceHosts,
    qa: { classification: 'public', publication_approved: true, contract_validated: true }
  };
}
