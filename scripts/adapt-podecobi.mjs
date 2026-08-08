/*
 * Adaptador del informe PODECOBI.
 *
 * A diferencia del radar regulatorio, este informe no nace de un Markdown: su
 * verdad está en `inventario_maestro.json`, catorce registros ya normalizados.
 * El adaptador los ordena en un contrato editorial y no infiere nada que el
 * insumo no declare.
 *
 * La geometría se toma del GeoJSON y el esquema unifilar de los archivos
 * `unifilares/polo_NN.tex`, que ya contienen la lectura hecha por el flujo
 * vigente. Volver a interpretar el texto libre de interconexión sería inventar.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs, requireArg } from './lib/args.mjs';

try {
  const args = parseArgs();
  const project = path.resolve(requireArg(args, 'project'));
  const output = path.resolve(args.output || '.shadow/podecobi.candidate.json');
  const version = String(args.version || '1.6.0');
  // La edición interna incorpora los enlaces institucionales; la pública no.
  const includeContacts = args.internal === true;
  const dataDir = path.join(project, 'data');

  const inventory = await readJson(path.join(dataDir, 'inventario_maestro.json'));
  if (!Array.isArray(inventory) || !inventory.length) throw new Error('El inventario maestro está vacío o no es una lista.');
  const geo = await readJson(path.join(dataDir, 'embedded_polos.geojson'));
  const pending = await readJson(path.join(dataDir, 'seguimiento_interno_podecobis_cambios_pendientes.json')).catch(() => null);

  const cutoff = args.cutoff ? String(args.cutoff) : latestCutoff(inventory);
  const shapes = indexShapes(geo);
  const diagrams = await readDiagrams(path.join(project, 'unifilares'));

  const totalArea = inventory.reduce((total, polo) => total + (Number(polo.official_area_ha) || 0), 0);
  const stages = tally(inventory.map((polo) => polo.stage).filter(Boolean));
  const states = new Set(inventory.map((polo) => polo.state).filter(Boolean));

  const avances = inventory
    .filter((polo) => Number.isFinite(Number(polo.progress_manual_pct)))
    .map((polo) => ({ polo, avance: Number(polo.progress_manual_pct) }))
    .sort((left, right) => right.avance - left.avance);
  const semaforo = { verde: [], ambar: [], rojo: [] };
  for (const item of avances) semaforo[tono(item.avance)].push(item);

  const bySurface = [...inventory]
    .filter((polo) => Number.isFinite(Number(polo.official_area_ha)))
    .sort((left, right) => Number(right.official_area_ha) - Number(left.official_area_ha));

  const sections = [];
  sections.push({
    id: 'panorama', level: 1, number: '1', title: 'Panorama general',
    blocks: [
      { type: 'lead', text: `El universo oficial comprende ${inventory.length} polos con declaratoria vigente en ${states.size} entidades y ${totalArea.toFixed(2)} hectáreas de superficie jurídica agregada.` },
      // La descripción del programa remite a su página oficial en lugar de
      // reformularla: este informe da seguimiento, no define la política.
      {
        type: 'paragraph',
        text: {
          text: `Cada polo se constituye por una declaratoria publicada en el Diario Oficial de la Federación y se acompaña de un convenio entre la Secretaría de Economía y el gobierno del estado. El seguimiento de esta edición se limita a lo que esos actos y las fichas oficiales declaran: superficie, etapa, vocaciones productivas, demanda eléctrica y de gas, e infraestructura de interconexión. La descripción del programa y sus estímulos corresponde a la Secretaría de Economía y puede consultarse en Polos de Desarrollo Económico para el Bienestar.`,
          runs: [
            { t: 'Cada polo se constituye por una declaratoria publicada en el Diario Oficial de la Federación y se acompaña de un convenio entre la Secretaría de Economía y el gobierno del estado. El seguimiento de esta edición se limita a lo que esos actos y las fichas oficiales declaran: superficie, etapa, vocaciones productivas, demanda eléctrica y de gas, e infraestructura de interconexión. La descripción del programa y sus estímulos corresponde a la Secretaría de Economía y puede consultarse en ' },
            { t: 'Polos de Desarrollo Económico para el Bienestar', u: 'https://www.gob.mx/se/acciones-y-programas/polos-de-desarrollo-economico-para-el-bienestar' },
            { t: '.' }
          ]
        }
      },
      { type: 'metrics', items: [
        { label: 'Polos declarados', value: String(inventory.length), detail: 'Universo oficial verificado' },
        { label: 'Entidades', value: String(states.size), detail: 'Con al menos un polo' },
        { label: 'Superficie agregada', value: `${totalArea.toFixed(2)} ha`, detail: 'Suma de la superficie oficial' },
        { label: 'Superficie media', value: `${(totalArea / inventory.length).toFixed(2)} ha`, detail: 'Promedio por polo' }
      ] },
      // El avance es la lectura que más se consulta, así que abre con su propio
      // semáforo y con el mismo color que después usan el mapa y las fichas.
      { type: 'heading', text: 'Avance del programa: semáforo por polo' },
      { type: 'metrics', items: [
        { label: 'Avance promedio', value: `${Math.round(avances.reduce((total, item) => total + item.avance, 0) / (avances.length || 1))}%`, detail: 'Promedio simple de los polos que lo reportan' },
        { label: 'En verde', value: String(semaforo.verde.length), detail: 'Avance de 50 % o más' },
        { label: 'En ámbar', value: String(semaforo.ambar.length), detail: 'Entre 20 % y 49 %' },
        { label: 'En rojo', value: String(semaforo.rojo.length), detail: 'Por debajo de 20 %' }
      ] },
      {
        type: 'chart-bars',
        eyebrow: 'Avance',
        caption: 'Avance reportado por polo',
        source: 'Avance manual del inventario maestro. Verde desde 50 %, ámbar entre 20 % y 49 %, rojo por debajo de 20 %.',
        items: avances.map(({ polo, avance }) => ({
          label: `${polo.num ?? ''} ${polo.official_name ?? ''}`.trim(),
          value: avance,
          display: `${avance}%`,
          tone: tono(avance)
        }))
      },
      {
        type: 'national-map',
        eyebrow: 'Distribución territorial',
        caption: `Los ${inventory.length} polos declarados y su entidad`,
        source: `Cada polo se ubica por el centroide de su polígono declarado. Los ${inventory.length} se distribuyen en ${states.size} entidades, de Baja California a Quintana Roo, sin que ninguna concentre más de uno.`,
        points: inventory
          .filter((polo) => Number.isFinite(polo.centroid_lon) && Number.isFinite(polo.centroid_lat))
          .map((polo) => ({ at: [polo.centroid_lon, polo.centroid_lat], label: String(polo.num ?? ''), name: polo.official_name ?? '', detail: polo.state ?? '', tone: Number.isFinite(Number(polo.progress_manual_pct)) ? tono(Number(polo.progress_manual_pct)) : undefined }))
      },
      {
        type: 'chart-bars',
        eyebrow: 'Superficie',
        caption: 'Hectáreas declaradas por polo',
        source: 'Superficie oficial del inventario maestro.',
        items: bySurface.map((polo) => ({
          label: `${polo.num ?? ''} ${polo.official_name ?? ''}`.trim(),
          value: Number(polo.official_area_ha),
          display: `${formatArea(polo.official_area_ha)} ha`
        }))
      },
      {
        type: 'chart-bars',
        eyebrow: 'Etapa',
        caption: 'Polos por etapa declarada',
        source: 'Etapa registrada en el inventario maestro.',
        items: [...stages].map(([stage, count]) => ({ label: stage, value: count, display: String(count) }))
      },
      // Una barra por entidad no dice nada cuando cada entidad tiene un polo:
      // se sustituye por la demanda máxima, que sí distingue entre ellos.
      {
        type: 'chart-bars',
        eyebrow: 'Demanda',
        caption: 'Demanda eléctrica máxima declarada por polo',
        source: 'Demanda máxima del inventario maestro; se omiten los polos que no la declaran en cifra.',
        items: inventory
          .map((polo) => ({ polo, mw: parseMegawatts(polo.maximum_demand) }))
          .filter((entry) => entry.mw !== null)
          .sort((left, right) => right.mw - left.mw)
          .map(({ polo, mw }) => ({
            label: `${polo.num ?? ''} ${polo.official_name ?? ''}`.trim(),
            value: mw,
            display: polo.maximum_demand
          }))
      }
    ]
  });

  sections.push({
    id: 'inventario-maestro', level: 1, number: '2', title: 'Inventario maestro',
    blocks: [{
      type: 'table',
      caption: `Universo oficial al ${cutoff}`,
      // Hay exactamente un polo por entidad, así que una columna sólo para la
      // entidad no distingue nada: se funde con el municipio y el espacio pasa
      // a la demanda y al avance, que sí varían y están completos en los
      // catorce registros. Inversión y empleos no sirven aquí: sólo dos
      // registros declaran inversión y ninguno declara empleos.
      headers: ['Núm.', 'Polo', 'Ubicación', 'Declaratoria', 'Superficie ha', 'Demanda máx.', 'Avance', 'Etapa'],
      rows: inventory.map((polo) => [
        polo.num ?? '',
        polo.declaration_url ? linked(polo.official_name, polo.declaration_url) : (polo.official_name ?? ''),
        [polo.municipality, polo.state].filter(Boolean).join(', '),
        polo.declaration_date ?? '',
        formatArea(polo.official_area_ha),
        polo.maximum_demand ?? '',
        Number.isFinite(Number(polo.progress_manual_pct)) ? `${polo.progress_manual_pct}%` : '',
        polo.stage ?? ''
      ])
    }]
  });

  sections.push({ id: 'fichas-por-polo', level: 1, number: '3', title: 'Fichas por polo', blocks: [] });
  for (const [index, polo] of inventory.entries()) {
    const shape = shapes.find(polo.centroid_lon, polo.centroid_lat);
    const diagram = diagrams.get(String(polo.num ?? '').padStart(2, '0'));
    const blocks = [poloBlock(polo, { includeContacts, resumido: true })];
    if (shape) {
      blocks.push({
        type: 'polo-map', label: polo.official_name ?? '', state: polo.state ?? '',
        area_ha: Number((Number(polo.official_area_ha) || 0).toFixed(2)),
        centroid: [polo.centroid_lon, polo.centroid_lat], rings: shape
      });
    }
    if (diagram) blocks.push({ ...diagram, type: 'unifilar', polo: `PODECOBI ${polo.official_name ?? ''}`.trim(), state: polo.state ?? '' });
    sections.push({
      id: slugify(`${polo.num ?? index + 1}-${polo.official_name ?? 'polo'}`),
      level: 2, number: `3.${index + 1}`,
      title: polo.official_name ?? `Polo ${index + 1}`,
      // Portadilla propia: el inventario se imprime y se reparte por fichas, así
      // que cada polo empieza en hoja nueva y se anuncia con sus cifras ancla.
      opener: {
        subtitle: [polo.municipality, polo.state].filter(Boolean).join(', '),
        badge: [polo.stage, polo.substage].filter(Boolean).join(' · '),
        metrics: [
          { label: 'Superficie', value: `${formatArea(polo.official_area_ha)} ha` },
          polo.electric_demand ? { label: 'Demanda', value: polo.electric_demand } : null,
          polo.maximum_demand ? { label: 'Demanda máxima', value: polo.maximum_demand } : null,
          Number.isFinite(Number(polo.progress_manual_pct)) ? { label: 'Avance', value: `${polo.progress_manual_pct}%` } : null
        ].filter(Boolean)
      },
      blocks
    });
  }

  const changes = Array.isArray(pending?.changes) ? pending.changes : [];
  sections.push({
    id: 'seguimiento-interno', level: 1, number: '4', title: 'Seguimiento interno',
    blocks: [
      { type: 'paragraph', text: changes.length
        ? `El monitoreo interno registró ${changes.length} cambio${changes.length === 1 ? '' : 's'} pendiente${changes.length === 1 ? '' : 's'} de validación al ${(pending.generated_utc ?? '').slice(0, 10)}.`
        : `El monitoreo interno no registró cambios pendientes al ${(pending?.generated_utc ?? cutoff).slice(0, 10)}.` },
      ...(pending?.editorial_rule ? [{ type: 'callout', label: 'Regla editorial', variant: 'scope', text: pending.editorial_rule }] : []),
      ...(changes.length ? [{ type: 'bullets', items: changes.map((change) => typeof change === 'string' ? change : JSON.stringify(change)) }] : [])
    ]
  });

  const sources = collectSources(inventory);
  const contract = {
    schema_version: 1,
    report_id: 'podecobi-dgmesnie',
    slug: 'podecobi',
    title: 'Polos de Desarrollo Económico para el Bienestar',
    subtitle: `Inventario maestro, geometría declarada e interconexión de los ${inventory.length} polos con declaratoria vigente`,
    description: `Inventario maestro y seguimiento de los ${inventory.length} PODECOBI con declaratoria vigente, con corte al ${cutoff}.`,
    kind: 'Inventario de polos',
    running_title: 'PODECOBI',
    cover: { variant: 'ribbon', photo: '/assets/reno-portada.png', photo_alt: 'Infraestructura industrial y energética' },
    version,
    cutoff,
    published_at: null,
    status: 'candidato shadow',
    classification: 'public-candidate',
    publication_approved: false,
    content_notice: 'Candidato generado en modo shadow a partir del inventario maestro. Requiere revisión editorial y autorización explícita antes de cualquier distribución.',
    summary: `Universo oficial de ${inventory.length} polos en ${states.size} entidades.`,
    highlights: [
      { label: 'Corte', value: cutoff, detail: 'Última verificación registrada en el inventario' },
      { label: 'Polos', value: String(inventory.length), detail: 'Con declaratoria vigente' },
      { label: 'Superficie', value: `${totalArea.toFixed(2)} ha`, detail: 'Suma de la superficie oficial' }
    ],
    sections,
    sources,
    optional_pdf: null,
    review: null,
    _private: {
      source_name: 'inventario_maestro.json',
      source_sha256: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
      adapter: 'podecobi-inventario-v1',
      source_path: project,
      adapted_at: new Date().toISOString()
    }
  };

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`, { flag: args.overwrite ? 'w' : 'wx' });
  console.log(JSON.stringify({
    status: 'shadow-candidate',
    output,
    polos: inventory.length,
    con_geometria: sections.filter((section) => section.blocks.some((block) => block.type === 'polo-map')).length,
    con_unifilar: sections.filter((section) => section.blocks.some((block) => block.type === 'unifilar')).length,
    sections: sections.length,
    sources: sources.length,
    cutoff,
    contactos: includeContacts
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

// Cuando el apartado abre con portadilla, ésta ya lleva ubicación, etapa,
// cifras ancla y avance. La ficha no los repite: se queda con las vocaciones y
// el detalle documental, que es lo que la portadilla no cabe a mostrar.
function poloBlock(polo, { includeContacts = false, resumido = false } = {}) {
  const metrics = [
    { label: 'Superficie oficial', value: `${formatArea(polo.official_area_ha)} ha`, detail: polo.declaration_date ? `Declaratoria del ${polo.declaration_date}` : '' },
    polo.electric_demand ? { label: 'Demanda eléctrica', value: polo.electric_demand, detail: polo.electric_demand_note ?? '' } : null,
    polo.maximum_demand ? { label: 'Demanda máxima', value: polo.maximum_demand, detail: polo.maximum_demand_note ?? '' } : null,
    polo.voltage ? { label: 'Tensión', value: polo.voltage } : null
  ].filter(Boolean);

  const documental = [
    polo.declaration_date ? { label: 'Declaratoria', value: polo.declaration_url ? linked(polo.declaration_date, polo.declaration_url) : polo.declaration_date } : null,
    polo.modification ? { label: 'Modificación', value: polo.modification_url ? linked(polo.modification, polo.modification_url) : polo.modification } : null,
    polo.project_last_review ? { label: 'Última revisión del proyecto', value: polo.project_url ? linked(polo.project_last_review, polo.project_url) : polo.project_last_review } : null,
    polo.committee ? { label: 'Comité', value: polo.agreement_url ? linked(polo.committee, polo.agreement_url) : polo.committee } : null,
    polo.verified_on ? { label: 'Verificado el', value: polo.verified_on } : null
  ].filter(Boolean);

  const infraestructura = [
    polo.connection ? { label: 'Interconexión', value: polo.connection } : null,
    polo.transmission_line ? { label: 'Línea de transmisión', value: polo.transmission_line } : null,
    polo.gas ? { label: 'Gas natural', value: [polo.gas, polo.gas_note].filter(Boolean).join(' · ') } : null,
    polo.pipeline ? { label: 'Ducto', value: polo.pipeline } : null
  ].filter(Boolean);

  const economia = [
    polo.investment ? { label: 'Inversión', value: polo.investment } : null,
    polo.jobs ? { label: 'Empleos', value: polo.jobs } : null
  ].filter(Boolean);

  // Los datos de contacto sólo se incorporan en la edición de circulación
  // interna. En una edición pública el gate los rechaza, y con razón.
  const contactos = includeContacts
    ? [
      contactField('Enlace federal', polo.federal_contact),
      contactField('Enlace estatal', polo.state_contact)
    ].filter(Boolean)
    : [];

  return {
    type: 'polo',
    ...(resumido ? {} : {
      state: polo.state ?? '',
      municipality: polo.municipality ?? '',
      stage: polo.stage ?? '',
      substage: polo.substage ?? ''
    }),
    ...(!resumido && Number.isFinite(Number(polo.progress_manual_pct)) ? { progress: Number(polo.progress_manual_pct) } : {}),
    metrics: resumido ? [] : metrics,
    activities: Array.isArray(polo.productive_activities) ? polo.productive_activities : [],
    groups: [
      { title: 'Sustento documental', fields: documental },
      { title: 'Infraestructura', fields: infraestructura },
      { title: 'Economía declarada', fields: economia },
      { title: 'Enlaces institucionales', fields: contactos }
    ].filter((group) => group.fields.length)
  };
}

// Cada `\SENERDiagramaPolo` trae siete grupos: polo, dos orígenes, la ruta
// alterna y las tres cifras de demanda. Sólo se limpia el marcado de LaTeX.
async function readDiagrams(directory) {
  const diagrams = new Map();
  const files = await readdir(directory).catch(() => []);
  for (const file of files) {
    const match = file.match(/^polo_(\d+)\.tex$/);
    if (!match) continue;
    const text = await readFile(path.join(directory, file), 'utf8');
    const groups = braceGroups(text.slice(text.indexOf('\\SENERDiagramaPolo') + 18));
    if (groups.length < 7) continue;
    const [, origen, segundo, alterna, inicial, horizonte, maxima] = groups;
    diagrams.set(match[1].padStart(2, '0'), {
      sources: [origen, segundo].map(texLines).filter((entry) => entry.label),
      alternate: texLines(alterna),
      metrics: [
        { value: cleanTex(inicial), label: 'Demanda inicial' },
        { value: cleanTex(horizonte), label: 'Horizonte' },
        { value: cleanTex(maxima), label: 'Demanda máxima', variant: 'madura' }
      ]
    });
  }
  return diagrams;
}

// Sólo se publica lo que el registro declara: nombre, cargo y medio de
// contacto, sin recomponer ni completar nada.
function contactField(label, contact) {
  if (!contact || typeof contact !== 'object') return null;
  const parts = [contact.nombre, contact.cargo, contact.correo].map((part) => String(part ?? '').trim()).filter(Boolean);
  return parts.length ? { label, value: parts.join(' · ') } : null;
}

function braceGroups(text) {
  const groups = [];
  let depth = 0;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '{') {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        groups.push(text.slice(start, index));
        if (groups.length === 7) break;
      }
    }
  }
  return groups;
}

function texLines(group) {
  const [label, detail] = String(group).split('\\\\');
  return { label: cleanTex(label), detail: cleanTex(detail ?? '') };
}

function cleanTex(value) {
  return String(value)
    .replace(/\\color\{[^}]*\}/g, '')
    .replace(/\\(bfseries|large|small|footnotesize|sffamily)\b/g, '')
    .replace(/\\\\/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/--/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

function indexShapes(geo) {
  const entries = (geo?.features ?? []).map((feature) => {
    const rings = feature.geometry?.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat()
      : (feature.geometry?.coordinates ?? []);
    const points = rings.flat();
    const lons = points.map(([lon]) => lon);
    const lats = points.map(([, lat]) => lat);
    return {
      rings: rings.map((ring) => ring.map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))])),
      box: { minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats) }
    };
  });
  // El emparejamiento va por geometría: los nombres del GeoJSON no coinciden con
  // los oficiales en varios polos y una coincidencia difusa asignaría el
  // polígono equivocado.
  return {
    find(lon, lat) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const hits = entries.filter(({ box }) => lon >= box.minLon && lon <= box.maxLon && lat >= box.minLat && lat <= box.maxLat);
      return hits.length === 1 ? hits[0].rings : null;
    }
  };
}

function collectSources(inventory) {
  const seen = new Map();
  for (const polo of inventory) {
    for (const [label, url] of [
      [`Declaratoria · ${polo.official_name}`, polo.declaration_url],
      [`Modificación · ${polo.official_name}`, polo.modification_url],
      [`Ficha de proyecto · ${polo.official_name}`, polo.project_url],
      [`Convenio · ${polo.official_name}`, polo.agreement_url]
    ]) {
      if (typeof url !== 'string' || !url.startsWith('https://')) continue;
      if (!seen.has(url)) seen.set(url, { label, url, institution: polo.state ?? '' });
    }
  }
  return [...seen.values()];
}

function latestCutoff(inventory) {
  const dates = inventory.map((polo) => polo.verified_on).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? ''));
  if (!dates.length) throw new Error('El inventario no declara fechas de verificación; indique --cutoff.');
  return dates.sort().at(-1);
}

// Sólo se grafica lo que viene en cifra. Un rango como «3.3–5.6 MW» se resuelve
// con su extremo superior, que es el valor que la propia ficha reporta como
// máximo; si no hay número, el polo no entra a la gráfica.
// Umbral único del semáforo: lo usan las cifras, las barras y el mapa.
function tono(avance) {
  if (avance >= 50) return 'verde';
  if (avance >= 20) return 'ambar';
  return 'rojo';
}

function parseMegawatts(value) {
  const numbers = String(value ?? '').match(/d+(?:[.,]d+)?/g);
  if (!numbers) return null;
  const parsed = numbers.map((number) => Number(number.replace(',', '.'))).filter(Number.isFinite);
  return parsed.length ? Math.max(...parsed) : null;
}

function formatArea(value) {
  const area = Number(value);
  return Number.isFinite(area) ? area.toFixed(2) : '';
}

function linked(text, url) {
  const label = String(text);
  return { text: label, runs: [{ t: label, u: url }] };
}

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1]);
}

function slugify(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
