import { createHash } from 'node:crypto';

export function adaptMarkdown(markdown, { sourceName = 'documento.md' } = {}) {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const metadata = parseFrontmatter(normalized);
  const body = normalized.replace(/^---\n[\s\S]*?\n---\n/, '');
  const title = metadata.titulo || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Panorama regulatorio energético';
  const sections = parseSections(body, title);
  if (!sections.length) sections.push({ id: 'contenido', title: 'Contenido', blocks: parseBlocks(body.replace(/^#\s+.+$/m, '')) });
  const sources = collectSources(normalized, sections);
  return {
    title: cleanInline(title),
    subtitle: cleanInline(metadata.subtitulo || ''),
    sourceVersion: metadata.version || null,
    sourceDate: metadata.fecha || null,
    semver: toSemver(metadata.version),
    isoDate: toIsoDate(metadata.fecha),
    sections,
    sources,
    privateProvenance: {
      source_name: sourceName,
      source_sha256: createHash('sha256').update(normalized).digest('hex'),
      adapter: 'radar-regulatorio-markdown-v1'
    }
  };
}

function parseSections(body, documentTitle) {
  const lines = body.split('\n');
  const sections = [];
  let current = null;
  let skippedDocumentTitle = false;
  for (const line of lines) {
    const heading = line.match(/^(#{1,2})\s+(.+)$/);
    if (heading) {
      const rawTitle = cleanInline(heading[2]);
      if (!skippedDocumentTitle && heading[1].length === 1 && rawTitle === cleanInline(documentTitle)) {
        skippedDocumentTitle = true;
        continue;
      }
      if (current) finishSection(current, sections);
      current = null;
      if (rawTitle.toLowerCase() === 'índice' || rawTitle.toLowerCase() === 'indice') {
        continue;
      }
      const number = rawTitle.match(/^(\d+(?:\.\d+)*)\.?\s+/)?.[1] || null;
      const displayTitle = rawTitle.replace(/^\d+(?:\.\d+)*\.?\s+/, '');
      current = { id: slugify(rawTitle), title: displayTitle, level: heading[1].length, number, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) finishSection(current, sections);
  return sections;
}

function finishSection(section, result) {
  const blocks = parseBlocks(section.lines.join('\n'), { sectionTitle: section.title });
  result.push({ id: section.id || `seccion-${result.length + 1}`, title: section.title, level: section.level, number: section.number, blocks });
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  return Object.fromEntries(match[1].split('\n').map((line) => {
    const separator = line.indexOf(':');
    if (separator < 1) return null;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    return [key, value];
  }).filter(Boolean));
}

function parseBlocks(text, { sectionTitle = '' } = {}) {
  const chunks = text.trim().split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  return chunks.map((chunk) => {
    const lines = chunk.split('\n');
    if (/^```mermaid\s*$/i.test(lines[0]) && /^```\s*$/.test(lines.at(-1))) {
      return parseMermaidFlow(lines.slice(1, -1));
    }
    if (lines.length > 1 && /^\s*\|?.+\|/.test(lines[0]) && /^\s*\|?\s*:?-{3,}/.test(lines[1])) {
      const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell));
      const headers = cells(lines[0]).map(plainOf);
      const rows = lines.slice(2).filter((line) => line.includes('|')).map(cells);
      if (headers.length >= 3 && normalize(headers[0]) === 'fecha' && normalize(headers[1]) === 'hito') {
        // La fecha se mantiene plana; hito y efecto conservan sus enlaces si el
        // markdown canónico los declara.
        return { type: 'timeline', items: rows.map((row) => ({ label: plainOf(row[0]), title: row[1] ?? '', text: row[2] ?? '' })) };
      }
      return { type: 'table', headers, rows, presentation: headers.length >= 2 ? 'comparison' : 'default' };
    }
    if (lines.every((line) => /^(?:[-*]|\d+\.)\s+/.test(line))) {
      const ordered = lines.every((line) => /^\d+\.\s+/.test(line));
      const items = lines.map((line) => inline(line.replace(/^(?:[-*]|\d+\.)\s+/, '')));
      if (ordered && /relaci[oó]n con planeaci[oó]n/i.test(sectionTitle)) return { type: 'steps', items };
      return { type: 'bullets', items };
    }
    if (/^###\s+/.test(chunk)) return { type: 'heading', text: cleanInline(chunk.replace(/^###\s+/, '')) };
    if (/^>\s*/.test(chunk)) {
      const raw = chunk.replace(/^>\s*/gm, ' ');
      const label = cleanInline(raw).match(/^\[([^\]]+)]\s*(?!\()/)?.[1];
      const body = inline(label ? raw.replace(/^\s*\[[^\]]+]\s*/, '') : raw);
      const plain = plainOf(body);
      if (!label && plain.includes('→')) return { type: 'process', items: plain.split('→').map((item) => item.replace(/[.]$/, '').trim()).filter(Boolean) };
      if (label) return { type: 'callout', label, text: body, variant: normalize(label).includes('riesgo') ? 'risk' : normalize(label).includes('alcance') ? 'scope' : 'note' };
      return { type: 'quote', text: body };
    }
    return { type: 'paragraph', text: inline(chunk.replace(/\n/g, ' ')) };
  }).filter((block) => block && (plainOf(block.text) || block.items?.length || block.nodes?.length || block.type === 'table'));
}

function parseMermaidFlow(lines) {
  const definitions = new Map();
  const edges = [];
  const direction = lines.find((line) => /^\s*(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*$/i.test(line))?.match(/(TD|TB|BT|LR|RL)\s*$/i)?.[1]?.toUpperCase() ?? 'TD';
  for (const line of lines) {
    for (const match of line.matchAll(/([A-Za-z0-9_]+)\s*\["([^"]+)"\]/g)) definitions.set(match[1], cleanInline(match[2]));
  }
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)(?:\s*\["[^"]+"\])?\s*-->\s*([A-Za-z0-9_]+)(?:\s*\["[^"]+"\])?\s*$/);
    if (match) edges.push({ source: match[1], target: match[2] });
  }
  const ids = [...new Set(edges.flatMap(({ source, target }) => [source, target]))];
  if (!ids.length) return { type: 'code', text: lines.join('\n') };
  return { type: 'flow', direction: direction === 'TB' ? 'TD' : direction, nodes: ids.map((id) => ({ id, label: definitions.get(id) || id })), edges };
}

const LINK_PATTERN = /\[([^\]]+)]\((https:\/\/[^\s)]+?)\)/g;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// El resultado canónico ya declara su versión y su fecha de corte. Derivarlas de
// ahí evita que la tarea programada tenga que repetirlas en cada corrida.
export function toSemver(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;
  return `${match[1]}.${match[2] ?? '0'}.${match[3] ?? '0'}`;
}

export function toIsoDate(value) {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.toLowerCase().match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})$/);
  if (!match) return null;
  const month = MESES.indexOf(match[2].normalize('NFD').replace(/[̀-ͯ]/g, ''));
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function cleanInline(text) {
  return text.replace(/\[([^\]]+)]\([^)]+\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
}

// El texto del informe conserva sus enlaces: el markdown canónico los declara y
// el lector debe poder abrirlos. Devuelve una cadena simple cuando no hay ligas
// y `{ text, runs }` cuando sí, para que el gate valide cada URL por separado.
function inline(value) {
  const raw = String(value);
  const tidy = (part) => part.replace(/[*_`]/g, '').replace(/\s+/g, ' ');
  const runs = [];
  let cursor = 0;
  let linked = false;
  let match;
  LINK_PATTERN.lastIndex = 0;
  while ((match = LINK_PATTERN.exec(raw))) {
    const before = tidy(raw.slice(cursor, match.index));
    if (before) runs.push({ t: before });
    const label = tidy(match[1]).trim() || match[1];
    runs.push({ t: label, u: match[2].replace(/[.,;:]+$/, '') });
    linked = true;
    cursor = LINK_PATTERN.lastIndex;
  }
  const rest = tidy(raw.slice(cursor));
  if (rest) runs.push({ t: rest });
  if (!runs.length) return '';
  runs[0].t = runs[0].t.replace(/^\s+/, '');
  runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, '');
  const kept = runs.filter((run) => run.t || run.u);
  if (!kept.length) return '';
  const text = kept.map((run) => run.t).join('');
  if (!linked) return text;
  return { text, runs: kept };
}

function plainOf(value) {
  return typeof value === 'string' ? value : String(value?.text ?? '');
}

// Las fuentes se reconstruyen desde los enlaces ya extraídos, con el apartado
// que los cita. Una etiqueta repetida se califica con el identificador del
// documento para que la lista deje de ser una columna de siglas idénticas.
function collectSources(normalized, sections) {
  const entries = new Map();
  const record = (url, label, context) => {
    const clean = url.replace(/[.,;:]+$/, '');
    if (!entries.has(clean)) entries.set(clean, { url: clean, label: label || hostOf(clean), context: context || '' });
  };
  for (const section of sections) {
    for (const run of runsOf(section.blocks)) {
      if (run.u) record(run.u, run.t, section.title);
    }
  }
  for (const match of normalized.matchAll(LINK_PATTERN)) record(match[2], cleanInline(match[1]), '');
  for (const match of normalized.matchAll(/https:\/\/[^\s)>\]"']+/g)) record(match[0], '', '');

  const labelUse = new Map();
  for (const entry of entries.values()) labelUse.set(entry.label, (labelUse.get(entry.label) ?? 0) + 1);
  return [...entries.values()].map((entry) => {
    const ambiguous = (labelUse.get(entry.label) ?? 0) > 1;
    const label = ambiguous ? `${entry.label} · ${documentReference(entry.url)}` : entry.label;
    return entry.context ? { label, url: entry.url, institution: entry.context } : { label, url: entry.url };
  });
}

function runsOf(blocks) {
  const found = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if (Array.isArray(value.runs)) found.push(...value.runs);
      else Object.values(value).forEach(visit);
    }
  };
  visit(blocks);
  return found;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function documentReference(url) {
  const note = url.match(/\/notas\/(\d+)/)?.[1];
  if (note) return `nota ${note}`;
  const file = url.match(/archivo=([^&]+)/)?.[1];
  if (file) return decodeURIComponent(file);
  try {
    const { pathname, hostname } = new URL(url);
    const tail = pathname.split('/').filter(Boolean).pop();
    return tail ? decodeURIComponent(tail) : hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalize(text) {
  return cleanInline(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function slugify(text) {
  return cleanInline(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
