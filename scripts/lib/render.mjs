import { readFileSync } from 'node:fs';
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

// El texto del contrato puede llegar como cadena simple o como `{ text, runs }`
// cuando conserva enlaces. El gate ya validó cada URL antes de llegar aquí.
export function renderRich(value) {
  if (value == null) return '';
  if (typeof value === 'string') return escapeHtml(value);
  if (!Array.isArray(value.runs)) return escapeHtml(value.text ?? '');
  return value.runs.map((run) => (run.u
    ? `<a class="inline-source" href="${escapeHtml(run.u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(run.t)}</a>`
    : escapeHtml(run.t))).join('');
}

export function reportKind(contract) {
  return contract.kind || 'Informe institucional';
}

// Rótulo que acompaña cada apertura de capítulo y la portada secundaria.
export function runningTitle(contract) {
  return contract.running_title || contract.kind || contract.title;
}

export function plainText(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value.text ?? '');
}

export function renderReport(contract, manifest, { immutable = false, baseUrl = null } = {}) {
  const reportPath = `/informes/${contract.slug}/`;
  const versionPath = `${reportPath}versiones/${manifest.release_id}/`;
  const canonicalPath = immutable ? versionPath : reportPath;
  const canonicalHref = baseUrl ? new URL(canonicalPath, baseUrl).href : canonicalPath;
  const closingSection = contract.sections.find((section) => normalizeText(section.title) === 'cierre');
  const contentSections = contract.sections.filter((section) => section !== closingSection);
  const topLevelSections = contentSections.filter((section) => (section.level ?? 1) === 1);
  const navigationSections = topLevelSections.length ? topLevelSections : contentSections;
  const nav = navigationSections.map((section, index) => `<a href="#${escapeHtml(section.id)}"><span>${escapeHtml(section.number || String(index + 1).padStart(2, '0'))}</span>${escapeHtml(section.title)}</a>`).join('');
  // El índice desagrega capítulos y apartados, como el documento impreso. El
  // paginador medido decide cuántas hojas necesita.
  const toc = contentSections.map((section, index) => {
    const level = section.level ?? 1;
    const number = section.number || String(index + 1).padStart(2, '0');
    return `<li class="toc-entry level-${level}"><a href="#${escapeHtml(section.id)}"><span>${escapeHtml(number)}</span><strong>${escapeHtml(section.title)}</strong><i></i><em>·</em></a></li>`;
  }).join('');
  const sections = renderContentPages(contentSections, contract);
  const sources = renderSourcePages(contract.sources, collectLinkRegistryUrls(contentSections));
  const highlights = (contract.highlights ?? []).map((item) => `<article class="metric"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><p>${escapeHtml(item.detail ?? '')}</p></article>`).join('');
  const sourceProfile = renderSourceProfile(contract.sources);
  const cover = renderEditorialCover(contract, manifest, { topLevelSections, contentSections });
  return pageShell({
    title: contract.title,
    description: contract.description,
    canonicalPath,
    canonicalHref,
    body: `
      ${renderReportHeader(contract)}
      <div class="reader-tools" aria-label="Herramientas de lectura">
        <div class="reader-pagination"><button type="button" data-reader-action="previous" aria-label="Página anterior">←</button><output data-page-indicator aria-live="polite">Lectura continua</output><button type="button" data-reader-action="next" aria-label="Página siguiente">→</button></div>
        <div class="reader-actions"><a href="#contenido">Índice</a><button type="button" data-reader-action="view">Vista por hojas</button><button type="button" data-reader-action="zoom-out" aria-label="Alejar">−</button><output data-zoom-indicator>100%</output><button type="button" data-reader-action="zoom-in" aria-label="Acercar">+</button><button type="button" data-reader-action="fit">Ajustar</button><button type="button" data-reader-action="fullscreen">Pantalla completa</button>${contract.optional_pdf ? `<a href="${escapeHtml(contract.optional_pdf)}">Descargar PDF</a>` : '<button type="button" data-reader-action="print">Imprimir / guardar PDF</button>'}</div>
        <span class="reading-track" aria-hidden="true"><i data-reading-progress></i></span>
      </div>
      <main${contract.classification === 'internal' ? ' data-distribution="interna"' : ''}>
        ${cover}
        <section class="report-toc" id="contenido" data-flow-list data-flow-label="Índice"><div class="toc-heading" data-flow-deck><div><p class="eyebrow">Navegación editorial</p><h2>Índice</h2></div><p>${topLevelSections.length} capítulos · ${contentSections.length} apartados · edición con corte al ${escapeHtml(contract.cutoff)}</p></div><p class="eyebrow toc-continued-label" data-flow-continued data-flow-counter>Índice</p><ol>${toc}</ol></section>
        <nav class="report-index" aria-label="Índice del informe"><p>En esta edición</p>${nav}</nav>
        ${highlights ? `<section class="metrics-grid" aria-label="Indicadores de publicación">${highlights}</section>` : ''}
        <div class="report-content" data-paginate data-cutoff="${escapeHtml(contract.cutoff)}">${sections}</div>
        ${sourceProfile}
        ${sources}
        ${renderClosing(closingSection, contract, manifest)}
      </main>
      ${renderReportFooter(contract, manifest, { canonicalPath, reportPath, versionPath, immutable, optionalPdf: contract.optional_pdf })}`
  });
}

// La portada de cinta es el formato estándar de los informes: cada uno declara
// su fotografía y su rótulo, no su slug.
function renderEditorialCover(contract, manifest, { topLevelSections, contentSections }) {
  const cover = contract.cover ?? {};
  if ((cover.variant ?? 'ribbon') === 'ribbon') {
    // La portada se compone en HTML para que el título exista en la capa de
    // texto del PDF y sea corregible.
    const period = coverPeriod(contract);
    return `<section class="report-cover editorial-cover regulatory-cover">
      <div class="regulatory-cover-art" aria-hidden="true">
        <img src="${escapeHtml(cover.photo ?? '/assets/portada-marco-regulatorio.jpg')}" alt="">
        <span class="cover-scrim"></span>
      </div>
      <header class="regulatory-cover-top">
        <p class="regulatory-cover-eyebrow">Secretaría de Energía<span>Subsecretaría de Planeación y Transición Energética</span></p>
        <img class="regulatory-cover-logo" src="/assets/sener-logo.png" alt="Secretaría de Energía">
      </header>
      <div class="regulatory-cover-lockup">
        ${period ? `<p class="regulatory-cover-period">${escapeHtml(period)}</p>` : ''}
        <h1>${escapeHtml(contract.title)}</h1>
        <p class="regulatory-cover-deck">${escapeHtml(contract.subtitle ?? contract.description ?? '')}</p>
      </div>
      <div class="regulatory-cover-foot">
        <p class="regulatory-cover-unit"><b>DGMESNIE</b><span>Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética</span></p>
        <dl class="regulatory-cover-meta">
          <div><dt>Corte documental</dt><dd>${escapeHtml(contract.cutoff)}</dd></div>
          <div><dt>Versión</dt><dd>${escapeHtml(contract.version)}</dd></div>
          <div class="regulatory-cover-status"><dt>Estado</dt><dd>${escapeHtml(contract.status)}</dd></div>
        </dl>
      </div>
    </section>`;
  }
  return `<section class="report-cover editorial-cover">
    <div class="cover-visual">
      <img class="cover-photo" src="${escapeHtml(cover.photo ?? '/assets/reno-portada.png')}" alt="${escapeHtml(cover.photo_alt ?? 'Infraestructura energética con generación solar, eólica y almacenamiento')}">
      <div class="visual-register"><span>${escapeHtml(reportKind(contract).toLocaleUpperCase('es-MX'))}</span><b>${escapeHtml(contract.cutoff.slice(0, 4))}</b></div>
      <div class="visual-stats"><span><b>${String(topLevelSections.length).padStart(2, '0')}</b> capítulos</span><span><b>${String(contentSections.length).padStart(2, '0')}</b> secciones</span><span><b>${String(manifest.source_count).padStart(2, '0')}</b> fuentes</span></div>
    </div>
    <div class="cover-rule"></div>
    <div class="cover-paper">
      <p class="cover-kicker"><i></i> Secretaría de Energía · Panorama sectorial</p>
      <h1>${escapeHtml(contract.title)}</h1>
      <p class="deck">${escapeHtml(contract.subtitle ?? contract.description ?? '')}</p>
      <div class="cover-meta"><div><span>Corte editorial</span><strong>${escapeHtml(contract.cutoff)}</strong></div><div><span>Edición</span><strong>${escapeHtml(manifest.release_id)}</strong></div><div><span>Estado</span><strong>${escapeHtml(contract.status)}</strong></div><img src="/assets/sener-logo.png" alt="Secretaría de Energía"></div>
      ${contract.content_notice ? `<div class="notice"><b>Aviso de contenido</b><span>${escapeHtml(contract.content_notice)}</span></div>` : ''}
      <div class="trace-line"><span>FUENTES ${manifest.source_count}</span><i></i><span>SHA-256 ${manifest.content_sha256.slice(0, 12)}</span><i></i><span>VERSIÓN ${escapeHtml(contract.version)}</span></div>
    </div>
  </section>`;
}

// El periodo revisado se lee del subtítulo del contrato; si no lo declara, la
// portada no inventa un rango.
function coverPeriod(contract) {
  const text = `${contract.subtitle ?? ''} ${contract.description ?? ''}`;
  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  if (years.length < 2) return '';
  const first = Math.min(...years);
  const last = Math.max(...years);
  return first === last ? String(first) : `${first}–${last}`;
}

export function renderPortal(catalog) {
  const hasLocalDraft = catalog.reports.some((report) => report.status.includes('borrador local'));
  const cards = catalog.reports.map((report) => `<article class="catalog-card"><div class="card-top"><span class="status-dot"></span><span>${escapeHtml(report.status)}</span></div><p class="eyebrow">${escapeHtml(report.kind)}</p><h2>${escapeHtml(report.title)}</h2><p>${escapeHtml(report.description)}</p><dl><div><dt>Última actualización</dt><dd>${escapeHtml(report.cutoff)}</dd></div><div><dt>Versión</dt><dd>${escapeHtml(report.version)}</dd></div></dl><div class="card-actions"><a class="button" href="${report.latest_path}">Abrir informe</a><a class="text-link" href="${report.version_path}">Última versión</a></div></article>`).join('');
  return pageShell({
    title: 'Informes DGMESNIE',
    description: 'Catálogo público de informes institucionales.',
    canonicalPath: '/',
    body: `
      ${renderPortalHeader()}
      <main>
        <section class="portal-hero"><div><p class="eyebrow">Inteligencia institucional · edición pública</p><h1>Informes que se consultan,<br><em>se verifican y permanecen.</em></h1><p class="deck">Un punto de acceso a publicaciones web con fecha de corte, versión estable y trazabilidad pública.</p><a class="button" href="#catalogo">Explorar informes</a></div><div class="hero-register"><span>CATÁLOGO</span><strong>${String(catalog.reports.length).padStart(2, '0')}</strong><p>${hasLocalDraft ? 'borrador local disponible' : 'informe disponible'}</p><i></i><span>ACTUALIZADO</span><b>${escapeHtml(catalog.generated_on)}</b></div></section>
        <section class="catalog-section" id="catalogo"><div class="section-heading"><div><p class="eyebrow">Publicaciones</p><h2>Catálogo de informes</h2></div><p>Cada tarjeta conduce a la última publicación y conserva un enlace directo a la edición inmutable.</p></div><div class="catalog-grid">${cards}</div></section>
        <section class="process" id="publicacion"><p class="eyebrow">Cadena de confianza</p><h2>De la validación a la consulta</h2><div class="process-grid"><article><span>01</span><h3>Conservar</h3><p>Las fuentes, detección de cambios y QA permanecen en el flujo vigente.</p></article><article><span>02</span><h3>Validar</h3><p>El contrato público bloquea rutas, secretos, datos personales y orígenes no autorizados.</p></article><article><span>03</span><h3>Publicar</h3><p>Latest facilita la consulta; la ruta versionada preserva cada edición aprobada.</p></article></div></section>
      </main>${renderPortalFooter(catalog)}`
  });
}

export function renderModelReport() {
  const model = {
    slug: 'modelo-editorial',
    kind: 'Modelo editorial',
    title: 'Informe modelo editorial',
    status: 'Modelo local · datos ilustrativos',
    cutoff: '2026-08-07',
    version: '1.0.0-modelo'
  };
  const toc = [
    ['modelo-portadilla', '00', 'Portadilla institucional'],
    ['modelo-editorial', '01', 'Texto editorial'],
    ['modelo-kpis', '02', 'KPIs y tarjetas'],
    ['modelo-graficas', '03', 'Gráficas interactivas'],
    ['modelo-mapa', '04', 'Mapa integrado'],
    ['modelo-tabla', '05', 'Tabla comparativa'],
    ['modelo-proceso', '06', 'Proceso y línea del tiempo'],
    ['modelo-figuras', '07', 'Figuras y galería'],
    ['modelo-diagrama', '08', 'Diagrama de relación'],
    ['modelo-bibliografia', '09', 'Bibliografía'],
    ['modelo-siglas', '10', 'Siglas y términos'],
    ['modelo-enlaces', '11', 'Enlaces oficiales'],
    ['modelo-mixta', '12', 'Gráfica mixta'],
    ['modelo-video', '13', 'Video integrado'],
    ['modelo-polo', '14', 'Ficha de polo'],
    ['modelo-polo-mapa', '15', 'Mapa del polo'],
    ['modelo-unifilar', '16', 'Esquema unifilar'],
    ['modelo-ficha-tecnica', '17', 'Ficha técnica y créditos']
  ];
  const tocItems = toc.map(([id, number, title]) => `<li><a href="#${id}"><span>${number}</span><strong>${title}</strong><i></i><em>Abrir</em></a></li>`).join('');
  const running = (number, title) => `<div class="chapter-running-head"><a href="#contenido-modelo">${number} · ${title}</a><span>Muestrario local · datos ilustrativos</span></div>`;
  const flow = renderFlow({
    type: 'flow', direction: 'LR',
    nodes: [
      { id: 'fuente', label: 'Fuente autorizada' },
      { id: 'validacion', label: 'Validación y QA' },
      { id: 'contrato', label: 'Contrato publicable' },
      { id: 'web', label: 'Informe web' },
      { id: 'correo', label: 'Correo con enlace' }
    ],
    edges: [
      { source: 'fuente', target: 'validacion' },
      { source: 'validacion', target: 'contrato' },
      { source: 'contrato', target: 'web' },
      { source: 'web', target: 'correo' }
    ]
  });
  const modelRegions = [
    { key: 'noreste', label: 'Noreste', short: 'NE', value: 320, color: '#3E8174' },
    { key: 'peninsular', label: 'Peninsular', short: 'PEN', value: 280, color: '#A33052' },
    { key: 'oriental', label: 'Oriental', short: 'ORI', value: 245, color: '#6FA89A' },
    { key: 'central', label: 'Central', short: 'CEN', value: 210, color: '#B24C6C' },
    { key: 'occidental', label: 'Occidental', short: 'OCC', value: 190, color: '#A57F2C' },
    { key: 'bcalifornia', label: 'B. California', short: 'BC', value: 165, color: '#7E3B52' },
    { key: 'noroeste', label: 'Noroeste', short: 'NO', value: 140, color: '#1E5B4F' },
    { key: 'norte', label: 'Norte', short: 'NTE', value: 118, color: '#9B2247' },
    { key: 'bcsur', label: 'B. C. Sur', short: 'BCS', value: 94, color: '#A9CDC3' },
    { key: 'mulege', label: 'Mulegé', short: 'MUL', value: 38, color: '#E0CA8E' }
  ];
  const modelRegionTotal = modelRegions.reduce((total, region) => total + region.value, 0);
  const modelRegionData = escapeHtml(JSON.stringify(Object.fromEntries(modelRegions.map(({ key, label, value, color }) => [key, { label, value, color }]))));
  const modelRegionBars = modelRegions.map((region) => `<li><span>${escapeHtml(region.label)}</span><i><b style="width:${((region.value / 320) * 100).toFixed(1)}%;background:${region.color}"></b></i><strong>${region.value.toLocaleString('es-MX')}</strong></li>`).join('');
  const modelRegionHeaders = modelRegions.map((region) => `<th style="--region-color:${region.color}" title="${escapeHtml(region.label)}">${escapeHtml(region.short)}</th>`).join('');
  const modelRegionValues = modelRegions.map((region) => `<td>${region.value.toLocaleString('es-MX')}</td>`).join('');
  const modelRegionShares = modelRegions.map((region) => `<td>${Math.round((region.value / modelRegionTotal) * 100)}%</td>`).join('');
  const modelIntroPages = `
    <section class="report-section model-title-page" id="modelo-portadilla"><div class="section-body">${running('00','Documento de consulta')}<div class="title-page-lockup"><p class="eyebrow">Documento de consulta institucional</p><h2>Informe modelo editorial para publicaciones web</h2><strong>2026</strong><div class="institutional-separator gold" aria-hidden="true"><i></i><b></b><i></i></div><p>Secretaría de Energía<br>Subsecretaría de Planeación y Transición Energética<br><b>DGMESNIE</b> · Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética</p><small>Formato carta 8.5 × 11 pulgadas · corte del modelo: 7 de agosto de 2026</small></div></div></section>
    <section class="report-section document-index-page" id="modelo-indice-figuras"><div class="section-body">${running('A','Índice de figuras')}<p class="eyebrow">Navegación documental</p><h2>Índice de figuras</h2><ol class="document-index"><li><a href="#modelo-graficas"><span>Gráficas 01–02. Magnitud y evolución</span><i></i><em>Abrir</em></a></li><li><a href="#modelo-mapa"><span>Mapa 01. Gerencias de Control Regional</span><i></i><em>Abrir</em></a></li><li><a href="#modelo-figuras"><span>Figura 01. Tratamiento editorial de imagen</span><i></i><em>Abrir</em></a></li><li><a href="#modelo-mixta"><span>Gráfica 03. Serie mixta interactiva</span><i></i><em>Abrir</em></a></li></ol><p class="index-guidance">Los números de hoja se calculan en el lector web; cada entrada conserva un enlace directo al componente.</p></div></section>
    <section class="report-section document-index-page" id="modelo-indice-tablas"><div class="section-body">${running('B','Índice de tablas')}<p class="eyebrow">Navegación documental</p><h2>Índice de tablas</h2><ol class="document-index"><li><a href="#modelo-tabla"><span>Cuadro 01. Estados, evidencia y decisión</span><i></i><em>Abrir</em></a></li><li><a href="#modelo-kpis"><span>Ficha 01. Cifras ancla y comparables</span><i></i><em>Abrir</em></a></li><li><a href="#modelo-proceso"><span>Secuencia 01. Ruta de publicación</span><i></i><em>Abrir</em></a></li></ol><p class="index-guidance">La lista sólo se genera cuando el informe contiene tablas, fichas o secuencias registradas.</p></div></section>`;
  const modelFeaturePages = `
    <section class="report-section official-links-page" id="modelo-enlaces"><div class="section-number">11</div><div class="section-body">${running('11','Enlaces oficiales')}<p class="eyebrow">Consulta externa</p><h2>Links de interés</h2><p class="lead">Cada dirección es visible, clicable y abre una pestaña nueva. El destino nunca sustituye la fuente registrada en el informe.</p><div class="table-wrap interest-links-wrap"><table class="interest-links-table"><caption>Tabla 02. Portales públicos para consulta y seguimiento</caption><thead><tr><th>Recurso</th><th>Para qué consultarlo</th><th>Enlace</th></tr></thead><tbody><tr><td><b>SENER</b><span>Secretaría de Energía</span></td><td>Información, documentos y comunicados del sector.</td><td><a href="https://www.gob.mx/sener" target="_blank" rel="noopener noreferrer">gob.mx/sener ↗</a></td></tr><tr><td><b>DOF</b><span>Diario Oficial de la Federación</span></td><td>Publicaciones oficiales y ejemplares por fecha.</td><td><a href="https://www.dof.gob.mx/" target="_blank" rel="noopener noreferrer">dof.gob.mx ↗</a></td></tr><tr><td><b>SIDOF</b><span>Sistema de consulta del DOF</span></td><td>Búsqueda y seguimiento de disposiciones publicadas.</td><td><a href="https://sidof.segob.gob.mx/" target="_blank" rel="noopener noreferrer">sidof.segob.gob.mx ↗</a></td></tr><tr><td><b>SIE</b><span>Sistema de Información Energética</span></td><td>Series y datos públicos del sector energético.</td><td><a href="https://sie.energia.gob.mx/" target="_blank" rel="noopener noreferrer">sie.energia.gob.mx ↗</a></td></tr></tbody></table></div><aside class="callout note"><b>Regla editorial</b><p>En producción, cada URL debe provenir del contrato publicable y aprobarse en el gate antes de mostrarse.</p></aside></div></section>
    <section class="report-section mixed-chart-page" id="modelo-mixta"><div class="section-number">12</div><div class="section-body">${running('12','Gráfica mixta')}<p class="eyebrow">Visualización interactiva · ECharts</p><h2>Área, columnas y línea en una sola lectura</h2><p class="lead">La combinación permite comparar magnitud y tendencia sin sacrificar la alternativa tabular.</p><figure class="mixed-chart-figure"><figcaption><b>Gráfica 03.</b> Evolución ilustrativa de dos indicadores normalizados</figcaption><div id="model-mixed-chart" class="interactive-chart mixed-chart" role="img" aria-label="Gráfica mixta ilustrativa con columnas, área y línea"></div></figure><div class="chart-fallback"><table><caption>Alternativa tabular</caption><thead><tr><th>Periodo</th><th>Capacidad (índice)</th><th>Demanda (índice)</th></tr></thead><tbody><tr><td>2022</td><td>62</td><td>76</td></tr><tr><td>2023</td><td>71</td><td>79</td></tr><tr><td>2024</td><td>83</td><td>82</td></tr><tr><td>2025</td><td>91</td><td>86</td></tr><tr><td>2026</td><td>104</td><td>89</td></tr></tbody></table></div><p class="chart-source">Fuente: serie sintética para demostrar interacción, tooltip y lectura combinada.</p></div></section>
    <section class="report-section media-page" id="modelo-video"><div class="section-number">13</div><div class="section-body">${running('13','Video integrado')}<p class="eyebrow">Contenido audiovisual</p><h2>Video integrado con enlace alternativo</h2><p class="lead">El reproductor conserva proporción 16:9 dentro de la hoja y ofrece salida directa si el proveedor bloquea la inserción.</p><figure class="video-figure"><div class="video-frame"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/cEV_7ScE3yU" title="Video de referencia sobre acciones del sector eléctrico" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div><figcaption><b>Video 01.</b> Referencia pública de demostración. <a href="https://www.youtube.com/watch?v=cEV_7ScE3yU" target="_blank" rel="noopener noreferrer">Abrir en el sitio de origen ↗</a></figcaption></figure><aside class="callout warning"><b>Uso controlado</b><p>La versión final sólo incrusta videos con autorización, título accesible, procedencia pública y vínculo alternativo.</p></aside></div></section>
    <section class="report-section polo-page" id="modelo-polo"><div class="section-number">14</div><div class="section-body">${running('14','Ficha de polo')}<p class="eyebrow">Componente territorial · datos oficiales</p><h2>Ficha de polo</h2>${renderPolo({
      type: 'polo',
      number: '01',
      name: 'Seybaplaya I',
      state: 'Campeche',
      municipality: 'Seybaplaya',
      stage: 'Preinversión',
      substage: 'Preparación',
      progress: 16,
      metrics: [
        { label: 'Superficie oficial', value: '99.99 ha', detail: 'Declaratoria del 30/06/2025' },
        { label: 'Demanda eléctrica', value: '6 MW', detail: 'al 2030' },
        { label: 'Demanda máxima', value: '10 MW', detail: 'al 2039' },
        { label: 'Tensión', value: '115 kV' }
      ],
      activities: ['Logística', 'Agroindustria', 'Manufactura ligada a la industria energética', 'Otras industrias ligeras'],
      groups: [
        { title: 'Sustento documental', fields: [
          { label: 'Declaratoria', value: { text: '30/06/2025 · DOF', runs: [{ t: '30/06/2025 · DOF', u: 'https://sidof.segob.gob.mx/notas/docFuente/5761459' }] } },
          { label: 'Modificación', value: 'Sin modificación localizada' },
          { label: 'Última revisión del proyecto', value: '16/02/2026' },
          { label: 'Comité', value: '9 de junio de 2025 · 1ª Sesión Ordinaria' }
        ] },
        { title: 'Infraestructura', fields: [
          { label: 'Interconexión', value: 'SE Samulá 80 MVA para primeros trenes; SE Seybaplaya 9.4 MVA requiere ampliación; apertura LT Lerma–Champotón 115 kV.' },
          { label: 'Gas natural', value: 'Sin disponibilidad · demanda no cuantificada' },
          { label: 'Ducto', value: 'Ducto Mayakán sin disponibilidad.' }
        ] }
      ]
    })}<p class="chart-source">Fuente: inventario maestro PODECOBI, corte del 14 de julio de 2026. Los datos de contacto del registro no se publican.</p></div></section>
    <section class="report-section polo-map-page" id="modelo-polo-mapa"><div class="section-number">15</div><div class="section-body">${running('15','Mapa del polo')}<p class="eyebrow">Componente territorial · geometría oficial</p><h2>Polígono declarado</h2><p class="lead">Se dibuja del propio GeoJSON: vectorial, sin mosaicos externos que la exportación bloquea, y con el contorno nacional reducido de 5 MB a 76 KB.</p>${renderPoloMap({"type":"polo-map","label":"Seybaplaya I","state":"Campeche","area_ha":99.99,"centroid":[-90.67611648,19.66490571],"rings":[[[-90.669222,19.662235],[-90.668318,19.667153],[-90.671879,19.66898],[-90.672157,19.668926],[-90.672596,19.668842],[-90.680207,19.66685],[-90.680335,19.6668],[-90.685119,19.665361],[-90.68461,19.663384],[-90.684678,19.662875],[-90.685505,19.662168],[-90.685561,19.662039],[-90.685563,19.661986],[-90.680188,19.662071],[-90.67816,19.662103],[-90.676329,19.662132],[-90.672979,19.662181],[-90.67296,19.662181],[-90.672961,19.662181],[-90.67296,19.662181],[-90.669222,19.662235]]]})}</div></section>
    <section class="report-section unifilar-page" id="modelo-unifilar"><div class="section-number">16</div><div class="section-body">${running('16','Esquema unifilar')}<p class="eyebrow">Componente territorial · interconexión</p><h2>Esquema unifilar</h2><p class="lead">Sustituye al dibujo TikZ del flujo LaTeX. El texto queda seleccionable dentro del PDF y el archivo pesa una fracción de la imagen.</p>${renderUnifilar({
      type: 'unifilar',
      polo: 'PODECOBI Seybaplaya I',
      state: 'Campeche',
      sources: [
        { label: 'SE Samulá', detail: '80 MVA · primeros trenes' },
        { label: 'SE Seybaplaya', detail: '9.4 MVA · requiere ampliación' }
      ],
      alternate: { label: 'LT Lerma–Champotón', detail: '115 kV' },
      metrics: [
        { value: '6 MW', label: 'Demanda inicial' },
        { value: '2030', label: 'Horizonte' },
        { value: '10 MW', label: 'Demanda máxima', variant: 'madura' }
      ]
    })}<p class="chart-source">Fuente: inventario maestro PODECOBI, corte del 14 de julio de 2026. Los datos de contacto del registro no se publican.</p></div></section>
    <section class="report-section technical-sheet-page" id="modelo-ficha-tecnica"><div class="section-number">17</div><div class="section-body">${running('17','Ficha técnica y créditos')}<p class="eyebrow">Control documental</p><h2>Ficha técnica de la edición</h2><p class="lead">La publicación cierra con los datos suficientes para citarla, reproducirla y comprobar cómo fue generada.</p><dl class="technical-metadata"><div><dt>Unidad responsable</dt><dd>DGMESNIE</dd></div><div><dt>Formato maestro</dt><dd>HTML semántico · CSS de impresión</dd></div><div><dt>Salida documental</dt><dd>PDF etiquetado · tamaño carta</dd></div><div><dt>Fuentes gráficas</dt><dd>Sistema de Diseño SENER</dd></div><div><dt>Datos de muestra</dt><dd>Sintéticos · no institucionales</dd></div><div><dt>Versión del modelo</dt><dd>1.0.0-modelo</dd></div></dl><div class="technical-grid"><article><p class="eyebrow">Cita sugerida</p><p>Secretaría de Energía (2026). <i>Informe modelo editorial para publicaciones web</i>. DGMESNIE.</p></article><article><p class="eyebrow">Créditos funcionales</p><ul><li>Coordinación editorial institucional</li><li>Validación de datos y fuentes</li><li>Diseño y publicación web</li><li>Aseguramiento de calidad</li></ul></article></div><aside class="callout note"><b>Regla de producción</b><p>Los informes particulares deben sustituir esta ficha con sus responsables, fuentes autorizadas, versión, corte, licencia y cita aprobada.</p></aside></div></section>`;
  return pageShell({
    title: model.title,
    description: 'Muestrario local y reutilizable del sistema editorial de Informes DGMESNIE.',
    canonicalPath: '/informes/modelo-editorial/',
    scripts: [
      '/assets/echarts.min.js',
      '/assets/gcr-data.js',
      '/assets/model.js'
    ],
    body: `
      ${renderReportHeader(model)}
      <div class="reader-tools" aria-label="Herramientas de lectura">
        <div class="reader-pagination"><button type="button" data-reader-action="previous" aria-label="Página anterior">←</button><output data-page-indicator aria-live="polite">Lectura continua</output><button type="button" data-reader-action="next" aria-label="Página siguiente">→</button></div>
        <div class="reader-actions"><a href="#contenido-modelo">Índice</a><button type="button" data-reader-action="view">Vista por hojas</button><button type="button" data-reader-action="zoom-out" aria-label="Alejar">−</button><output data-zoom-indicator>100%</output><button type="button" data-reader-action="zoom-in" aria-label="Acercar">+</button><button type="button" data-reader-action="fit">Ajustar</button><button type="button" data-reader-action="fullscreen">Pantalla completa</button><button type="button" data-reader-action="print">Imprimir / guardar PDF</button></div>
        <span class="reading-track" aria-hidden="true"><i data-reading-progress></i></span>
      </div>
      <main class="model-report">
        <section class="report-cover editorial-cover model-cover">
          <div class="cover-visual model-cover-visual"><div class="cover-date-mark">07 · 08 · 2026</div><div class="cover-year-stage"><svg class="cover-year-svg" viewBox="0 0 620 405" role="img" aria-labelledby="model-cover-year-title"><title id="model-cover-year-title">2026 compuesto con una imagen autorizada de infraestructura energética</title><defs><clipPath id="model-year-mask" clipPathUnits="userSpaceOnUse"><text x="42" y="205">20</text><text x="258" y="382">26</text></clipPath><linearGradient id="model-year-shade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#731a36" stop-opacity=".18"/><stop offset="1" stop-color="#e0a12e" stop-opacity=".08"/></linearGradient></defs><image href="/assets/reno-portada.png" width="620" height="405" preserveAspectRatio="xMidYMid slice" clip-path="url(#model-year-mask)"/><rect width="620" height="405" fill="url(#model-year-shade)" clip-path="url(#model-year-mask)"/><g class="cover-year-outline" aria-hidden="true"><text x="42" y="205">20</text><text x="258" y="382">26</text></g></svg></div><div class="visual-register"><span>INFORMES · DGMESNIE</span><b>MODELO EDITORIAL</b></div><div class="visual-stats"><span><b>14</b> familias</span><span><b>01</b> sistema</span><span><b>CARTA</b> 8.5 × 11</span></div></div>
          <div class="cover-rule"></div><div class="cover-paper"><p class="cover-kicker"><i></i> Subsecretaría de Planeación y Transición Energética</p><h1>Informe modelo<br>editorial</h1><p class="deck">Repertorio de páginas, datos, mapas y referencias para construir informes web con proporción carta.</p><div class="institutional-separator wine" aria-hidden="true"><i></i><b></b><i></i></div><p class="cover-office"><b>DGMESNIE</b><span>Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética</span></p><div class="model-disclaimer">Muestrario técnico. Todas las cifras y referencias de ejemplo son ilustrativas.</div><div class="cover-meta"><div><span>Formato</span><strong>Carta · 8.5 × 11 in</strong></div><div><span>Corte del modelo</span><strong>7 de agosto de 2026</strong></div><div><span>Versión</span><strong>1.0.0-modelo</strong></div><img src="/assets/sener-logo.png" alt="Secretaría de Energía"></div></div>
        </section>
        <section class="report-toc" id="contenido-modelo"><div class="toc-heading"><div><p class="eyebrow">Contenido</p><h2>Índice del modelo</h2></div><p>Catorce familias de componentes con páginas documentales completas.</p></div><ol>${tocItems}</ol><div class="toc-note"><b>Uso previsto</b><span>Seleccionar sólo los componentes que correspondan a la estructura canónica de cada informe.</span></div></section>
        <div class="report-content model-pages">
          ${modelIntroPages}
          <section class="chapter-opener" id="modelo-editorial"><div class="chapter-opener-top"><span>Sección 01</span><i></i><small>Composición documental</small></div><div class="chapter-opener-title"><strong>01</strong><h2>Texto editorial y aparato crítico</h2><p>Columnas, citas, llamadas, notas al pie y jerarquía de lectura.</p><div class="institutional-separator emerald" aria-hidden="true"><i></i><b></b><i></i></div></div><div class="chapter-opener-contents"><b>En este capítulo</b><span>Dos columnas</span><span>Cita destacada</span><span>Notas y fuentes</span></div></section>
          <section class="report-section model-editorial-page"><div class="section-number">01</div><div class="section-body">${running('01','Texto editorial')}<p class="eyebrow">Composición</p><h2>Dos columnas con cita y notas al pie</h2><div class="text-columns"><div><p>Este bloque demuestra una caja editorial de lectura extensa. El texto se justifica, conserva una medida cómoda y utiliza Patria para títulos y Noto Sans para el cuerpo. La información de cada informe debe proceder de su contrato canónico validado.</p><p>La columna puede incorporar énfasis, referencias numeradas y una llamada lateral sin convertir el documento en un tablero genérico.<sup><a href="#modelo-nota-1">1</a></sup></p></div><blockquote><p>La visualización complementa el análisis; nunca sustituye la fuente, la fecha de corte ni la trazabilidad.</p><cite>Criterio editorial del modelo</cite></blockquote><div><p>El segundo bloque muestra continuidad visual. Los subtítulos, filetes y blancos forman una secuencia reconocible incluso cuando el contenido cambia entre informes.</p><aside class="callout note"><b>Regla de uso</b><p>Si la estructura canónica no soporta una figura o un hito, se utiliza el texto legible como alternativa.</p></aside></div></div><ol class="footnotes"><li id="modelo-nota-1"><span>1</span><p>Nota ilustrativa: el informe final debe sustituir este texto por la fuente pública aprobada.</p></li></ol></div></section>
          <section class="report-section" id="modelo-kpis"><div class="section-number">02</div><div class="section-body">${running('02','KPIs y tarjetas')}<p class="eyebrow">Datos · valores ilustrativos</p><h2>Cifras ancla y fichas comparables</h2><div class="model-kpis"><article style="--accent:#0e8a6e"><span>Cobertura</span><strong>84%</strong><p>Indicador ilustrativo con unidad explícita.</p></article><article style="--accent:#e0a12e"><span>Registros</span><strong>1,248</strong><p>Conteo ficticio para probar miles.</p></article><article style="--accent:#1e9cb8"><span>Variación</span><strong>+12.4%</strong><p>Delta de ejemplo, sin interpretación sustantiva.</p></article><article style="--accent:#9b2247"><span>Pendientes</span><strong>07</strong><p>Estado demostrativo.</p></article></div><div class="region-cards"><article><p class="eyebrow">Ficha A</p><h3>Región demostrativa</h3><dl><div><dt>Capacidad</dt><dd>320 MW</dd></div><div><dt>Proyectos</dt><dd>08</dd></div><div><dt>Estado</dt><dd><span class="model-badge positive">Validado</span></dd></div></dl></article><article><p class="eyebrow">Ficha B</p><h3>Escenario de prueba</h3><dl><div><dt>Capacidad</dt><dd>145 MW</dd></div><div><dt>Proyectos</dt><dd>05</dd></div><div><dt>Estado</dt><dd><span class="model-badge warning">En revisión</span></dd></div></dl></article></div><p class="chart-source">Fuente: datos sintéticos creados únicamente para validar la plantilla.</p></div></section>
          <section class="report-section model-chart-page" id="modelo-graficas"><div class="section-number">03</div><div class="section-body">${running('03','Gráficas interactivas')}<p class="eyebrow">ECharts · dependencia local fijada</p><h2>Magnitud y evolución</h2><div class="chart-grid"><figure><figcaption><span>Gráfica 01</span>Comparativo por categoría</figcaption><div id="model-bar-chart" class="interactive-chart" role="img" aria-label="Gráfica ilustrativa de barras por categoría"></div></figure><figure><figcaption><span>Gráfica 02</span>Serie temporal</figcaption><div id="model-line-chart" class="interactive-chart" role="img" aria-label="Gráfica ilustrativa de línea por periodo"></div></figure></div><div class="chart-fallback"><table><caption>Alternativa tabular de las gráficas</caption><thead><tr><th>Categoría</th><th>Periodo 1</th><th>Periodo 2</th></tr></thead><tbody><tr><td>A</td><td>120 MW</td><td>146 MW</td></tr><tr><td>B</td><td>88 MW</td><td>102 MW</td></tr><tr><td>C</td><td>62 MW</td><td>75 MW</td></tr></tbody></table></div><p class="chart-source">Fuente: serie sintética para prueba de interacción y accesibilidad.</p></div></section>
          <section class="report-section model-map-page" id="modelo-mapa"><div class="section-number">04</div><div class="section-body">${running('04','Mapa integrado')}<p class="eyebrow">Mapa GCR · sistema de diseño</p><h2>Una lectura territorial completa</h2><p class="lead">Mapa, comparación y tabla comparten la misma serie sintética para demostrar una composición verificable.</p><div class="map-kpi-strip"><article><span>Total ilustrativo</span><strong>${modelRegionTotal.toLocaleString('es-MX')} <small>MW</small></strong><p>Suma de las diez regiones del ejemplo.</p></article><article><span>GCR representadas</span><strong>${modelRegions.length} <small>de 10</small></strong><p>Cobertura completa del muestrario.</p></article></div><div class="map-analysis-grid"><figure class="map-canvas-panel"><figcaption><b>Mapa 01.</b> Distribución ilustrativa por Gerencia de Control Regional</figcaption><div id="model-gcr-map" class="interactive-map" data-regions="${modelRegionData}" role="img" aria-label="Mapa demostrativo interactivo de las Gerencias de Control Regional"></div><div id="model-map-detail" class="map-detail" aria-live="polite"><b>Seleccione una región</b><span>La ficha mostrará su color y un valor de demostración.</span></div></figure><aside class="map-ranking" aria-labelledby="model-ranking-title"><h3 id="model-ranking-title">Comparación por GCR <small>(MW)</small></h3><ol>${modelRegionBars}</ol></aside></div><div class="table-wrap map-summary-wrap"><table class="map-summary-table"><caption>Cuadro 02. Resumen de valores ilustrativos por región</caption><thead><tr><th>Indicador</th>${modelRegionHeaders}</tr></thead><tbody><tr><th>MW</th>${modelRegionValues}</tr><tr><th>Participación</th>${modelRegionShares}</tr></tbody></table></div><p class="chart-source">Geometría: Sistema de Diseño SENER. Valores: serie sintética para validar interacción, orden y accesibilidad.</p></div></section>
          <section class="report-section" id="modelo-tabla"><div class="section-number">05</div><div class="section-body">${running('05','Tabla comparativa')}<p class="eyebrow">Comparación</p><h2>Estados, evidencia y decisión</h2><figure class="table-figure"><figcaption><span>Cuadro 01</span>Tratamiento institucional de una matriz comparativa</figcaption><div class="table-wrap"><table><thead><tr><th>Instrumento</th><th>Estado</th><th>Valor ilustrativo</th><th>Evidencia requerida</th></tr></thead><tbody><tr><td>Elemento A</td><td><span class="model-badge positive">Publicado</span></td><td>320 MW</td><td>Enlace público aprobado</td></tr><tr><td>Elemento B</td><td><span class="model-badge warning">En revisión</span></td><td>145 MW</td><td>Validación pendiente</td></tr><tr><td>Elemento C</td><td><span class="model-badge neutral">No localizado</span></td><td>—</td><td>Registrar búsqueda y corte</td></tr><tr><td>Elemento D</td><td><span class="model-badge positive">Vigente</span></td><td>75 MW</td><td>Documento oficial</td></tr></tbody></table></div></figure><aside class="callout warning"><b>Decisión</b><p>La tabla comunica estado y evidencia sin inferir hechos que el contrato publicable no declare.</p></aside></div></section>
          <section class="report-section" id="modelo-proceso"><div class="section-number">06</div><div class="section-body">${running('06','Proceso y línea del tiempo')}<p class="eyebrow">Secuencia</p><h2>Ruta de publicación</h2><ol class="editorial-steps"><li><span>01</span><p>Conservar fuentes y detección del flujo vigente.</p></li><li><span>02</span><p>Transformar el resultado canónico mediante un adaptador.</p></li><li><span>03</span><p>Validar el contrato publicable con reglas fail-closed.</p></li><li><span>04</span><p>Generar latest y versión inmutable.</p></li></ol><div class="timeline"><article><span>Corte</span><div><h3>Entrada validada</h3><p>Se registra el momento documental del informe.</p></div></article><article><span>QA</span><div><h3>Revisión publicable</h3><p>Se bloquean secretos, rutas y datos no autorizados.</p></div></article><article><span>Salida</span><div><h3>Publicación idempotente</h3><p>Un contenido sin cambios produce no-op.</p></div></article></div></div></section>
          <section class="report-section model-figure-page" id="modelo-figuras"><div class="section-number">07</div><div class="section-body">${running('07','Figuras y galería')}<p class="eyebrow">Media</p><h2>Figura con pie, fuente y recorte editorial</h2><figure class="model-figure"><img src="/assets/reno-anexos.png" alt="Infraestructura eléctrica con paneles solares y aerogeneradores"><figcaption><b>Figura 01.</b> Tratamiento de imagen para apertura de anexo.<span>Fuente: activo autorizado del Sistema de Diseño SENER.</span></figcaption></figure><div class="model-gallery"><figure><img src="/assets/reno-portada.png" alt="Infraestructura energética"><figcaption>Encuadre panorámico</figcaption></figure><figure><img src="/assets/mujer.png" alt="Ilustración institucional de mujer con bandera"><figcaption>Ilustración institucional</figcaption></figure></div></div></section>
          <section class="report-section diagram-sheet" id="modelo-diagrama"><div class="section-number">08</div><div class="section-body">${running('08','Diagrama de relación')}<p class="eyebrow">Estructura</p><h2>Flujo de última milla</h2>${flow}</div></section>
          <section class="report-section reference-page" id="modelo-bibliografia"><div class="section-number">09</div><div class="section-body">${running('09','Bibliografía')}<p class="eyebrow">Aparato de referencia</p><h2>Bibliografía</h2><ol class="bibliography"><li><span>[1]</span><p>Secretaría de Energía. <i>Título ilustrativo de documento público</i>. Fecha de consulta de ejemplo.</p></li><li><span>[2]</span><p>Diario Oficial de la Federación. <i>Referencia demostrativa para composición</i>. Enlace por aprobar.</p></li><li><span>[3]</span><p>DGMESNIE. <i>Contrato publicable del informe</i>. Ejemplo técnico local.</p></li><li><span>[4]</span><p>Sistema de Diseño SENER. <i>Tokens, componentes y activos institucionales</i>.</p></li></ol><aside class="callout note"><b>Nota</b><p>Estas referencias son de muestra y no deben citarse como evidencia institucional.</p></aside></div></section>
          <section class="report-section reference-page" id="modelo-siglas"><div class="section-number">10</div><div class="section-body">${running('10','Siglas y términos')}<p class="eyebrow">Referencia</p><h2>Siglas y términos</h2><dl class="acronym-list"><div><dt>DGMESNIE</dt><dd>Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética.</dd></div><div><dt>SPTE</dt><dd>Subsecretaría de Planeación y Transición Energética.</dd></div><div><dt>QA</dt><dd>Aseguramiento de calidad aplicado al contrato publicable.</dd></div><div><dt>URL</dt><dd>Dirección estable para consultar la última edición o una versión inmutable.</dd></div><div><dt>QR</dt><dd>Código de respuesta rápida que enlaza al informe web.</dd></div></dl></div></section>
          ${modelFeaturePages}
        </div>
        <section class="report-closing narrative-closing model-closing"><div class="closing-header"><p class="eyebrow">Cierre del modelo</p><img src="/assets/sener-logo.png" alt="Secretaría de Energía"></div><div class="closing-statement"><span aria-hidden="true">C</span><h2>Una arquitectura común para informes distintos.</h2><p>La forma puede cambiar con cada tema. La claridad, la evidencia y la permanencia deben mantenerse en todas las ediciones.</p></div><div class="institutional-separator gold closing-horizon" aria-hidden="true"><i></i><b></b><i></i></div><div class="closing-principles"><article><b>Claridad</b><p>Texto legible y una jerarquía que guía sin distraer.</p></article><article><b>Evidencia</b><p>Fuentes públicas, corte documental y vínculos verificables.</p></article><article><b>Permanencia</b><p>Una URL estable y una versión inmutable por edición.</p></article></div><div class="closing-signature"><div><strong>DGMESNIE</strong><span>Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética</span></div><div><b>Subsecretaría de Planeación y Transición Energética</b><small>Modelo editorial · 2026</small></div></div></section>
        <section class="report-back-cover model-back-cover"><div class="back-cover-year" aria-hidden="true"><span>20</span><span>26</span></div><div class="back-cover-logos"><img src="/assets/gobierno-mexico-logo.png" alt="Gobierno de México"><img src="/assets/sener-logo.png" alt="Secretaría de Energía"></div><div class="back-cover-main"><img class="back-cover-woman" src="/assets/mujer.png" alt="Ilustración institucional de una mujer portando la bandera de México"><div><p class="eyebrow">Cierre institucional</p><h2>Gracias</h2><p>Subsecretaría de Planeación y Transición Energética</p><strong>Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética</strong></div></div><div class="back-cover-bottom"><div><span>DGMESNIE</span><small>Informe modelo editorial · 2026</small></div><div class="qr-lockup"><div class="qr-code" data-qr-path="/informes/modelo-editorial/"><a href="/informes/modelo-editorial/">Abrir modelo</a></div><p>Consulte el modelo web</p></div></div></section>
      </main>`
  });
}

function renderPortalHeader() {
  return `<header class="site-header portal-header">
    <a class="brand" href="/" aria-label="Informes DGMESNIE — inicio">
      <img class="institution-logo" src="/assets/sener-logo.png" alt="Secretaría de Energía">
      <span class="brand-divider"></span><span class="product-name">Informes</span>
    </a>
    <nav aria-label="Navegación principal"><a class="active" href="/">Inicio</a><a href="#catalogo">Catálogo</a><a href="#publicacion">Cómo se publica</a></nav>
    <span class="header-status"><i></i>Portal de informes</span>
  </header>`;
}

function renderReportHeader(contract) {
  const kind = reportKind(contract);
  return `<div class="report-shell-head">
    <header class="site-header report-header">
      <a class="brand" href="/" aria-label="Informes DGMESNIE — inicio">
        <img class="institution-logo" src="/assets/sener-logo.png" alt="Secretaría de Energía">
        <span class="brand-divider"></span><span class="product-name">Informes</span>
      </a>
      <a class="header-link" href="/">Ver catálogo</a>
    </header>
    <div class="report-context" aria-label="Ruta del informe"><div><a href="/">Informes</a><span>›</span><a href="/informes/${escapeHtml(contract.slug)}/">${escapeHtml(kind)}</a><span>›</span><strong>${escapeHtml(contract.status)}</strong></div><span class="context-release">Corte ${escapeHtml(contract.cutoff)} · v${escapeHtml(contract.version)}</span></div>
  </div>`;
}

function renderPortalFooter(catalog) {
  const hasLocalDraft = catalog.reports.some((report) => report.status.includes('borrador local'));
  return `<footer class="site-footer portal-footer">
    <div class="footer-grid">
      <div class="footer-identity"><img class="institution-logo footer-logo" src="/assets/sener-logo.png" alt="Secretaría de Energía"><p>Portal público de informes de la Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética.</p></div>
      <div><p class="footer-label">Informes</p><a href="#catalogo">Catálogo</a><a href="#publicacion">Cómo se publica</a><a href="https://www.gob.mx/sener" rel="noopener noreferrer">Portal SENER</a></div>
      <div><p class="footer-label">Consulta oficial</p><a href="https://www.dof.gob.mx/" rel="noopener noreferrer">Diario Oficial</a><a href="https://sidof.segob.gob.mx/" rel="noopener noreferrer">SIDOF</a><a href="https://www.gob.mx/" rel="noopener noreferrer">gob.mx</a></div>
      <div class="footer-state"><p class="footer-label">Estado</p><span><i></i>${hasLocalDraft ? 'Borrador local' : 'Contenido público'}</span><small>${hasLocalDraft ? 'No publicado · ' : ''}catálogo actualizado al ${escapeHtml(catalog.generated_on)}</small></div>
    </div>
    <div class="footer-bottom"><span>© 2026 Secretaría de Energía · Gobierno de México</span><span>Versiones y manifiestos verificables</span></div>
  </footer>`;
}

// El pie recoge los enlaces de la edición: la banda dedicada ocupaba una franja
// entera para tres vínculos que caben aquí sin romper la lectura del libro.
function renderReportFooter(contract, manifest, { canonicalPath, reportPath, versionPath, immutable = false, optionalPdf = null }) {
  const editionLink = immutable
    ? `<a href="${reportPath}">Ver última edición</a>`
    : `<a href="${versionPath}">Versión inmutable</a>`;
  return `<footer class="site-footer report-footer">
    <div class="report-footer-main"><div><strong>Secretaría de Energía</strong><span>DGMESNIE · ${escapeHtml(contract.title)}</span></div><div><span>Corte ${escapeHtml(contract.cutoff)}</span><span class="mono">${escapeHtml(manifest.release_id)}</span></div></div>
    <div class="footer-bottom"><a href="/">Catálogo de informes</a>${editionLink}<a href="${canonicalPath}manifest.json">Manifiesto público</a>${optionalPdf ? `<a href="${escapeHtml(optionalPdf)}">Descargar PDF</a>` : ''}<span>SHA-256 ${manifest.content_sha256.slice(0, 12)}</span></div>
  </footer>`;
}

function renderContentPages(contentSections, contract) {
  const output = [];
  let currentChapter = null;

  for (const [index, section] of contentSections.entries()) {
    const isChapter = (section.level ?? 1) === 1;
    const diagramBlocks = (section.blocks ?? []).filter((block) => block.type === 'flow');
    const narrativeBlocks = (section.blocks ?? []).filter((block) => block.type !== 'flow');
    const hasNarrative = narrativeBlocks.length > 0;

    if (isChapter) {
      currentChapter = section;
      const nextChapter = contentSections.findIndex((candidate, candidateIndex) => candidateIndex > index && (candidate.level ?? 1) === 1);
      const chapterSections = contentSections.slice(index + 1, nextChapter < 0 ? undefined : nextChapter);
      const subheads = chapterSections.filter((candidate) => (candidate.level ?? 1) === 2).map((candidate) => candidate.title);
      output.push(`<section class="chapter-opener" id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-opener-title"><div class="chapter-opener-top"><span>Sección ${escapeHtml(section.number || String(index + 1).padStart(2, '0'))}</span><i></i><small>Corte ${escapeHtml(contract.cutoff)}</small></div><div class="chapter-opener-title"><strong>${escapeHtml(section.number || String(index + 1).padStart(2, '0'))}</strong><h2 id="${escapeHtml(section.id)}-opener-title">${escapeHtml(section.title)}</h2><p>${escapeHtml(runningTitle(contract))} · edición ${escapeHtml(contract.version)}</p></div>${subheads.length ? `<div class="chapter-opener-contents"><b>En este capítulo</b>${subheads.slice(0, 4).map((title) => `<span>${escapeHtml(title)}</span>`).join('')}</div>` : ''}</section>`);
    }

    const runningHead = currentChapter ? `<div class="chapter-running-head"><a href="#contenido">${escapeHtml(currentChapter.number || '')} · ${escapeHtml(currentChapter.title)}</a><span>Corte ${escapeHtml(contract.cutoff)}</span></div>` : '';
    // Un apartado puede pedir su propia portadilla. Para un inventario que se
    // imprime y se reparte por partes, cada ficha necesita empezar en hoja
    // propia y anunciarse.
    if (section.opener && !isChapter) {
      output.push(renderSectionOpener(section, currentChapter, contract));
    }

    if (hasNarrative) {
      output.push(renderFlowTopic({ section, blocks: narrativeBlocks, chapter: currentChapter, index, isChapter }));
    }

    if (diagramBlocks.length) {
      output.push(diagramBlocks.map((block, diagramIndex) => {
        const diagramId = !isChapter && !hasNarrative && diagramIndex === 0 ? section.id : `${section.id}-diagrama-${diagramIndex + 1}`;
        return `<section class="report-section diagram-sheet level-${section.level ?? 1}" id="${escapeHtml(diagramId)}"><div class="section-number">${escapeHtml(section.number || '')}</div><div class="section-body">${runningHead}<p class="eyebrow">Diagrama ${String(diagramIndex + 1).padStart(2, '0')} · estructura canónica</p><h2>${escapeHtml(section.title)}</h2>${renderFlow(block)}</div></section>`;
      }).join(''));
    }
  }
  return output.join('');
}

// El servidor emite un flujo semántico por apartado. El paginador medido del
// lector reparte estos temas en hojas carta usando la altura real compuesta.
function renderFlowTopic({ section, blocks, chapter, index, isChapter }) {
  const number = section.number || String(index + 1).padStart(2, '0');
  const id = isChapter ? `${section.id}-detalle` : section.id;
  const attributes = [
    `id="${escapeHtml(id)}"`,
    'data-topic',
    `data-number="${escapeHtml(number)}"`,
    `data-title="${escapeHtml(section.title)}"`,
    `data-level="${section.level ?? 1}"`,
    chapter ? `data-chapter-number="${escapeHtml(chapter.number || '')}"` : '',
    chapter ? `data-chapter-title="${escapeHtml(chapter.title)}"` : ''
  ].filter(Boolean).join(' ');
  return `<article class="report-topic packed-topic level-${section.level ?? 1}" ${attributes}>` +
    `<div class="packed-topic-heading"><span>${escapeHtml(number)}</span><h2>${escapeHtml(section.title)}</h2></div>` +
    `${section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : ''}` +
    `${blocks.map(renderBlock).join('')}` +
    '</article>';
}

// Portadilla de apartado: hoja propia que anuncia la ficha que sigue, con sus
// cifras ancla. La declara el contrato en `opener`, así que ningún informe la
// recibe sin pedirla.
function renderSectionOpener(section, chapter, contract) {
  const opener = section.opener === true ? {} : (section.opener ?? {});
  const number = section.number || '';
  const metrics = (opener.metrics ?? []).slice(0, 4).map((metric) =>
    `<article><span>${escapeHtml(metric.label ?? '')}</span><strong>${escapeHtml(metric.value ?? '')}</strong></article>`).join('');
  return `<section class="section-opener" id="${escapeHtml(section.id)}-portadilla" aria-labelledby="${escapeHtml(section.id)}-portadilla-title">
    <div class="section-opener-top">
      <span>${escapeHtml(chapter ? `${chapter.number || ''} · ${chapter.title}` : contract.title)}</span><i></i>
      <small>Corte ${escapeHtml(contract.cutoff)}</small>
    </div>
    <div class="section-opener-title">
      <strong>${escapeHtml(number)}</strong>
      <h2 id="${escapeHtml(section.id)}-portadilla-title">${escapeHtml(section.title)}</h2>
      ${opener.subtitle ? `<p>${escapeHtml(opener.subtitle)}</p>` : ''}
      ${opener.badge ? `<span class="section-opener-badge">${escapeHtml(opener.badge)}</span>` : ''}
      <div class="institutional-separator gold" aria-hidden="true"><i></i><b></b><i></i></div>
    </div>
    ${metrics ? `<div class="section-opener-metrics">${metrics}</div>` : ''}
  </section>`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks.length ? chunks : [[]];
}

// Los capítulos de ligas ya son un índice navegable de fuentes. El apéndice no
// los repite: sólo recoge lo citado en el resto del informe.
const LINK_REGISTRY_TITLE = /ligas de inter[eé]s|portales oficiales/i;

function collectLinkRegistryUrls(contentSections) {
  const urls = new Set();
  let insideRegistry = false;
  for (const section of contentSections) {
    if ((section.level ?? 1) === 1) insideRegistry = LINK_REGISTRY_TITLE.test(section.title ?? '');
    if (!insideRegistry) continue;
    for (const block of section.blocks ?? []) {
      if (block.type !== 'table') continue;
      collectRunUrls(block, urls);
    }
  }
  return urls;
}

function collectRunUrls(value, urls) {
  if (Array.isArray(value)) {
    for (const item of value) collectRunUrls(item, urls);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.runs)) {
    for (const run of value.runs) if (run?.u) urls.add(run.u);
    return;
  }
  for (const item of Object.values(value)) collectRunUrls(item, urls);
}

// El apéndice sale como una sola lista; el paginador medido decide cuántas
// hojas necesita y cuántos enlaces caben en cada una.
function renderSourcePages(sources, indexedUrls = new Set()) {
  const pending = sources.filter((source) => !indexedUrls.has(source.url));
  if (!pending.length) return '';
  const items = pending.map((source) => `<li><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.label)}</a>${source.institution ? `<span>${escapeHtml(source.institution)}</span>` : ''}</li>`).join('');
  const indexed = sources.length - pending.length;
  const deck = indexed
    ? `Las otras ${indexed} fuentes de esta edición están enlazadas en su lugar y reunidas en el capítulo de ligas de interés. El manifiesto público conserva las ${sources.length}.`
    : 'Enlaces oficiales preservados en el contrato publicable de esta edición.';
  return `<section class="sources" data-flow-list data-flow-label="Trazabilidad pública"><p class="eyebrow" data-flow-counter>Trazabilidad pública</p><h2>${indexed ? 'Fuentes citadas fuera del índice de ligas' : 'Fuentes consultables'}</h2><p class="sources-deck" data-flow-deck>${escapeHtml(deck)}</p><ol>${items}</ol></section>`;
}

function renderBlock(block) {
  if (block.type === 'heading') return `<h3>${renderRich(block.text)}</h3>`;
  if (block.type === 'lead') return `<p class="lead">${renderRich(block.text)}</p>`;
  if (block.type === 'paragraph') return `<p>${renderRich(block.text)}</p>`;
  if (block.type === 'bullets') return `<ul>${block.items.map((item) => `<li>${renderRich(item)}</li>`).join('')}</ul>`;
  if (block.type === 'steps') return `<ol class="editorial-steps">${block.items.map((item, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><p>${renderRich(item)}</p></li>`).join('')}</ol>`;
  if (block.type === 'process') return `<div class="process-sequence" aria-label="Secuencia descrita en el documento">${block.items.map((item, index) => `<div><span>${String(index + 1).padStart(2, '0')}</span><strong>${renderRich(item)}</strong></div>`).join('')}</div>`;
  if (block.type === 'callout') return `<aside class="callout ${escapeHtml(block.variant ?? 'note')}"><b>${escapeHtml(block.label ?? 'Nota')}</b><p>${renderRich(block.text)}</p></aside>`;
  if (block.type === 'quote') return `<blockquote class="norm-quote"><p>${renderRich(block.text)}</p></blockquote>`;
  if (block.type === 'table') return `<figure class="table-figure"><figcaption><span>Cuadro comparativo</span>${escapeHtml(block.caption ?? 'Lectura estructurada de la información canónica')}</figcaption><div class="table-wrap"><table><thead><tr>${block.headers.map((cell) => `<th>${renderRich(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${renderRich(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></figure>`;
  if (block.type === 'timeline') return `<div class="timeline">${block.items.map((item) => `<article><span>${escapeHtml(item.label)}</span><div><h3>${renderRich(item.title)}</h3><p>${renderRich(item.text)}</p></div></article>`).join('')}</div>`;
  if (block.type === 'flow') return renderFlow(block);
  if (block.type === 'polo') return renderPolo(block);
  if (block.type === 'unifilar') return renderUnifilar(block);
  if (block.type === 'polo-map') return renderPoloMap(block);
  if (block.type === 'chart-bars') return renderBarChart(block);
  if (block.type === 'national-map') return renderNationalMap(block);
  if (block.type === 'metrics') return `<div class="metrics-grid">${block.items.map((item) => `<article class="metric"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><p>${escapeHtml(item.detail ?? '')}</p></article>`).join('')}</div>`;
  if (block.type === 'code') return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
  return '';
}

// Gráfica de barras en SVG. Se prefiere al gráfico interactivo porque el
// documento se imprime: aquí las etiquetas y las cifras son texto real y no
// dependen de que un script llegue a ejecutarse.
function renderBarChart(block) {
  const items = (block.items ?? []).filter((item) => Number.isFinite(Number(item.value)));
  if (!items.length) return '';
  const maximum = Math.max(...items.map((item) => Number(item.value)));
  const rowHeight = 46;
  // La columna de etiquetas se dimensiona con el texto más largo: con un ancho
  // fijo, los nombres largos quedaban debajo de las barras.
  const longestLabel = Math.max(...items.map((item) => String(item.label ?? '').length));
  const labelWidth = Math.min(440, Math.max(170, longestLabel * 10.5 + 16));
  // Si aun al tope la etiqueta no cabe, se reduce el cuerpo en vez de recortar
  // el texto: el nombre del polo debe leerse completo.
  const labelSize = Math.max(13, Math.min(21, (labelWidth - 16) / (longestLabel * 0.5)));
  const longestValue = Math.max(...items.map((item) => String(item.display ?? item.value).length));
  const valueWidth = Math.min(160, Math.max(70, longestValue * 12 + 16));
  const width = 1000;
  const height = items.length * rowHeight + 12;
  const trackWidth = width - labelWidth - valueWidth - 24;
  // Un tono opcional agrupa las barras por estado: el mismo semáforo que usan
  // el mapa y la ficha, para que el lector no traduzca entre representaciones.
  const dotted = items.some((item) => item.tone);
  const rows = items.map((item, index) => {
    const value = Number(item.value);
    const y = index * rowHeight + 6;
    const barWidth = maximum > 0 ? Math.max(2, (value / maximum) * trackWidth) : 2;
    const tone = item.tone ? ` tono-${item.tone}` : '';
    return `<g class="barra">
      ${dotted ? `<circle class="barra-punto${tone}" cx="8" cy="${y + 20}" r="7"/>` : ''}
      <text class="barra-etiqueta" x="${dotted ? 26 : 0}" y="${y + 26}" style="font-size:${labelSize.toFixed(1)}px">${escapeHtml(item.label ?? '')}</text>
      <rect class="barra-pista" x="${labelWidth}" y="${y + 10}" width="${trackWidth}" height="20" rx="2"/>
      <rect class="barra-valor${tone}" x="${labelWidth}" y="${y + 10}" width="${barWidth.toFixed(1)}" height="20" rx="2"/>
      <text class="barra-cifra${tone}" x="${width - valueWidth + 8}" y="${y + 26}">${escapeHtml(item.display ?? String(value))}</text>
    </g>`;
  }).join('');
  const id = `barras-${hashText(items.map((item) => `${item.label}:${item.value}`).join('|'))}`;
  const resumen = items.map((item) => `${item.label}: ${item.display ?? item.value}`).join('; ');
  return `<figure class="chart-figure">
    <figcaption><span>${escapeHtml(block.eyebrow ?? 'Distribución')}</span>${escapeHtml(block.caption ?? '')}</figcaption>
    <svg class="chart-bars" viewBox="0 0 ${width} ${height}" style="aspect-ratio:${width} / ${height}" role="img" aria-labelledby="${id}-title ${id}-desc">
      <title id="${id}-title">${escapeHtml(block.caption ?? 'Distribución')}</title>
      <desc id="${id}-desc">${escapeHtml(resumen)}</desc>
      ${rows}
    </svg>
    ${block.source ? `<p class="chart-source">${escapeHtml(block.source)}</p>` : ''}
  </figure>`;
}

// Mapa nacional con los puntos declarados. Reutiliza el contorno simplificado.
function renderNationalMap(block) {
  const outline = mexicoOutline();
  const points = (block.points ?? []).filter((point) => Array.isArray(point.at) && point.at.length === 2);
  if (!outline || !points.length) return '';
  const box = { w: 1000, h: 575, pad: 20 };
  const bounds = { minLon: -118.5, maxLon: -86.0, minLat: 14.3, maxLat: 32.9 };
  const compress = Math.cos(23 * Math.PI / 180);
  const scale = Math.min(
    (box.w - box.pad * 2) / ((bounds.maxLon - bounds.minLon) * compress),
    (box.h - box.pad * 2) / (bounds.maxLat - bounds.minLat)
  );
  const project = ([lon, lat]) => [
    (box.pad + (lon - bounds.minLon) * compress * scale).toFixed(1),
    (box.pad + (bounds.maxLat - lat) * scale).toFixed(1)
  ];
  // Las entidades con polo se distinguen del resto del país. El nombre corto de
  // uso común no coincide con la denominación completa del marco geoestadístico,
  // así que la comparación tolera que uno contenga al otro.
  const conPolo = [...new Set(points.map((point) => normalizeText(point.detail ?? '')).filter(Boolean))];
  const alberga = (nombre) => {
    const estado = normalizeText(nombre).replace(/^estado de /, '');
    return conPolo.some((declarado) => {
      const corto = declarado.replace(/^estado de /, '');
      return estado === corto || estado.startsWith(`${corto} `) || corto.startsWith(`${estado} `);
    });
  };
  const paises = outline.states.map((state) => {
    const path = state.rings.map((ring) => `${ring.map((point, index) => `${index ? 'L' : 'M'} ${project(point).join(' ')}`).join(' ')} Z`).join(' ');
    return `<path class="polo-map-pais${alberga(state.name) ? ' mapa-estado-activo' : ''}" d="${path}"/>`;
  }).join('');
  const marcas = points.map((point) => {
    const [x, y] = project(point.at);
    const tone = point.tone ? ` tono-${point.tone}` : '';
    return `<g class="mapa-punto${tone}"><circle cx="${x}" cy="${y}" r="14"/><text x="${x}" y="${(Number(y) + 6).toFixed(1)}" text-anchor="middle">${escapeHtml(point.label ?? '')}</text></g>`;
  }).join('');
  // Leyenda al pie: el número del mapa por sí solo no dice qué polo es.
  const leyenda = points.some((point) => point.name)
    ? `<ol class="mapa-leyenda">${points.map((point) => `<li><span class="${point.tone ? `tono-${point.tone}` : ''}">${escapeHtml(point.label ?? '')}</span><b>${escapeHtml(point.name ?? '')}</b>${point.detail ? `<em>${escapeHtml(point.detail)}</em>` : ''}</li>`).join('')}</ol>`
    : '';
  const id = `mapa-nacional-${hashText(points.map((point) => point.at.join(',')).join('|'))}`;
  return `<figure class="chart-figure">
    <figcaption><span>${escapeHtml(block.eyebrow ?? 'Distribución territorial')}</span>${escapeHtml(block.caption ?? '')}</figcaption>
    <svg class="mapa-nacional" viewBox="0 0 ${box.w} ${box.h}" role="img" aria-labelledby="${id}-title ${id}-desc">
      <title id="${id}-title">${escapeHtml(block.caption ?? 'Distribución territorial')}</title>
      <desc id="${id}-desc">${escapeHtml(points.map((point) => `${point.label}: ${point.name ?? ''}`).join('; '))}</desc>
      ${paises}
      ${marcas}
    </svg>
    ${leyenda}
    ${block.source ? `<p class="chart-source">${escapeHtml(block.source)}</p>` : ''}
  </figure>`;
}

// Contorno nacional simplificado para el localizador. Se carga una sola vez y
// su ausencia sólo suprime el recuadro, nunca rompe el informe.
let contornoNacional;
function mexicoOutline() {
  if (contornoNacional !== undefined) return contornoNacional;
  try {
    contornoNacional = JSON.parse(readFileSync(new URL('../../config/mexico-estados.json', import.meta.url), 'utf8'));
  } catch {
    contornoNacional = null;
  }
  return contornoNacional;
}

// Mapa de un polo: su polígono declarado a escala, con barra de escala y un
// localizador nacional. Sustituye a la imagen rasterizada del flujo LaTeX; se
// dibuja del propio GeoJSON, así que no depende de mosaicos externos que la
// exportación bloquea.
function renderPoloMap(block) {
  const rings = (block.rings ?? []).filter((ring) => Array.isArray(ring) && ring.length > 2);
  if (!rings.length) return '';
  const points = rings.flat();
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  // La longitud se comprime con el coseno de la latitud media para que la
  // parcela no salga estirada a lo ancho.
  const compress = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) || 1;
  const width = Math.max((maxLon - minLon) * compress, 1e-6);
  const height = Math.max(maxLat - minLat, 1e-6);
  const box = { w: 900, h: 560, pad: 42 };
  const scale = Math.min((box.w - box.pad * 2) / width, (box.h - box.pad * 2) / height);
  const offsetX = (box.w - width * scale) / 2;
  const offsetY = (box.h - height * scale) / 2;
  const project = ([lon, lat]) => [
    (offsetX + (lon - minLon) * compress * scale).toFixed(1),
    (offsetY + (maxLat - lat) * scale).toFixed(1)
  ];
  const shapes = rings.map((ring) => `<path class="polo-map-shape" d="${ring.map((point, index) => `${index ? 'L' : 'M'} ${project(point).join(' ')}`).join(' ')} Z"/>`).join('');

  // Barra de escala: se elige una distancia redonda que ocupe menos de un
  // tercio del ancho útil.
  // `width` ya viene comprimido por el coseno, así que equivale a la distancia
  // este-oeste real medida en grados de latitud.
  const metersPerDegree = 111320;
  const usableMeters = width * metersPerDegree;
  const candidates = [100, 200, 500, 1000, 2000, 5000];
  const barMeters = candidates.find((value) => value <= usableMeters / 3) ?? candidates[0];
  const barPixels = (barMeters / metersPerDegree) * scale;
  const bar = barPixels > 20 && barPixels < box.w * 0.6
    ? `<g class="polo-map-escala"><path d="M ${box.pad} ${box.h - 24} h ${barPixels.toFixed(1)}"/>` +
      `<path d="M ${box.pad} ${box.h - 30} v 12"/><path d="M ${(box.pad + barPixels).toFixed(1)} ${box.h - 30} v 12"/>` +
      `<text x="${(box.pad + barPixels + 10).toFixed(1)}" y="${box.h - 19}">${barMeters >= 1000 ? `${barMeters / 1000} km` : `${barMeters} m`}</text></g>`
    : '';

  const outline = mexicoOutline();
  let locator = '';
  if (outline && Array.isArray(block.centroid) && block.centroid.length === 2) {
    const inset = { w: 260, h: 170, pad: 8 };
    const bounds = { minLon: -118.5, maxLon: -86.5, minLat: 14.4, maxLat: 32.8 };
    const insetCompress = Math.cos(23 * Math.PI / 180);
    const insetScale = Math.min(
      (inset.w - inset.pad * 2) / ((bounds.maxLon - bounds.minLon) * insetCompress),
      (inset.h - inset.pad * 2) / (bounds.maxLat - bounds.minLat)
    );
    const insetPoint = ([lon, lat]) => [
      (inset.pad + (lon - bounds.minLon) * insetCompress * insetScale).toFixed(1),
      (inset.pad + (bounds.maxLat - lat) * insetScale).toFixed(1)
    ];
    const paises = outline.states.map((state) => state.rings
      .map((ring) => `${ring.map((point, index) => `${index ? 'L' : 'M'} ${insetPoint(point).join(' ')}`).join(' ')} Z`).join(' ')).join(' ');
    const marca = insetPoint(block.centroid);
    locator = `<g class="polo-map-localizador" transform="translate(${box.w - inset.w - 12} 12)">
      <rect width="${inset.w}" height="${inset.h}" rx="4"/>
      <path class="polo-map-pais" d="${paises}"/>
      <circle class="polo-map-punto" cx="${marca[0]}" cy="${marca[1]}" r="6"/>
    </g>`;
  }

  const coords = Array.isArray(block.centroid)
    ? `${Math.abs(block.centroid[1]).toFixed(4)}° ${block.centroid[1] >= 0 ? 'N' : 'S'}, ${Math.abs(block.centroid[0]).toFixed(4)}° ${block.centroid[0] >= 0 ? 'E' : 'O'}`
    : '';
  const id = `polo-map-${hashText(`${block.label ?? ''}|${minLon}|${minLat}`)}`;
  const resumen = [block.label, block.state, block.area_ha ? `${block.area_ha} hectáreas` : '', coords].filter(Boolean).join(', ');

  return `<figure class="polo-map-figure">
    <figcaption><span>Polígono declarado</span>${escapeHtml(block.caption ?? `Superficie y ubicación de ${block.label ?? 'el polo'}`)}</figcaption>
    <svg class="polo-map" viewBox="0 0 ${box.w} ${box.h}" role="img" aria-labelledby="${id}-title ${id}-desc">
      <title id="${id}-title">Polígono declarado de ${escapeHtml(block.label ?? 'el polo')}</title>
      <desc id="${id}-desc">${escapeHtml(resumen)}</desc>
      <rect class="polo-map-fondo" width="${box.w}" height="${box.h}"/>
      ${shapes}${bar}${locator}
    </svg>
    <dl class="polo-map-datos">
      ${block.area_ha ? `<div><dt>Superficie</dt><dd>${escapeHtml(String(block.area_ha))} ha</dd></div>` : ''}
      ${coords ? `<div><dt>Centroide</dt><dd>${escapeHtml(coords)}</dd></div>` : ''}
      ${block.state ? `<div><dt>Entidad</dt><dd>${escapeHtml(block.state)}</dd></div>` : ''}
    </dl>
  </figure>`;
}

// Ficha de un polo: identificación, cifras ancla, datos documentales y
// vocaciones productivas. Los grupos y sus campos vienen del contrato, de modo
// que el renderizador no decide qué se publica de cada registro.
function renderPolo(block) {
  const badge = block.stage ? `<span class="polo-etapa">${escapeHtml(block.stage)}${block.substage ? ` · ${escapeHtml(block.substage)}` : ''}</span>` : '';
  const metrics = (block.metrics ?? []).map((metric) => `<article><span>${escapeHtml(metric.label ?? '')}</span><strong>${escapeHtml(metric.value ?? '')}</strong>${metric.detail ? `<p>${escapeHtml(metric.detail)}</p>` : ''}</article>`).join('');
  const groups = (block.groups ?? []).map((group) => {
    const rows = (group.fields ?? []).map((field) => `<div><dt>${escapeHtml(field.label ?? '')}</dt><dd>${renderRich(field.value)}</dd></div>`).join('');
    return rows ? `<section class="polo-grupo"><h3>${escapeHtml(group.title ?? '')}</h3><dl>${rows}</dl></section>` : '';
  }).join('');
  const activities = (block.activities ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const progress = Number.isFinite(block.progress) ? `<div class="polo-avance"><span>Avance reportado</span><i><b style="width:${Math.max(0, Math.min(100, block.progress))}%"></b></i><strong>${block.progress}%</strong></div>` : '';

  // El nombre sólo se imprime si el bloque lo trae. Cuando la ficha es el
  // contenido de un apartado que ya se titula con el polo, repetirlo llenaría
  // la hoja con el mismo texto dos veces.
  const named = Boolean(block.name);
  const conEncabezado = named || block.municipality || block.state || block.stage;
  return `<article class="polo-ficha${named ? '' : ' polo-ficha-sin-titulo'}">
    ${conEncabezado ? `<header class="polo-encabezado">
      ${named ? `<div><span class="polo-numero">${escapeHtml(block.number ?? '')}</span><h2>${escapeHtml(block.name)}</h2></div>` : ''}
      <p class="polo-ubicacion">${escapeHtml([block.municipality, block.state].filter(Boolean).join(', '))}</p>
      ${badge}
    </header>` : ''}
    ${metrics ? `<div class="polo-cifras">${metrics}</div>` : ''}
    ${progress}
    ${activities ? `<section class="polo-vocaciones"><h3>Vocaciones productivas</h3><ul>${activities}</ul></section>` : ''}
    ${groups}
  </article>`;
}

// Diagrama unifilar de un polo. Reproduce en SVG la figura que el flujo LaTeX
// dibujaba con TikZ: subestaciones de origen arriba, ruta de interconexión,
// el polo al centro y las tres cifras de demanda al pie. En SVG el texto queda
// seleccionable y pesa una fracción de la imagen.
function renderUnifilar(block) {
  const sources = (block.sources ?? []).slice(0, 2);
  const alternate = block.alternate ?? null;
  const metrics = (block.metrics ?? []).slice(0, 3);
  // El lienzo usa centímetros del original multiplicados por cien.
  const px = (x) => (740 + x * 100).toFixed(0);
  const py = (y) => (470 - y * 100).toFixed(0);
  // El texto se ajusta a la caja: primero se reparte en renglones y, si aun así
  // el más largo se sale, se reduce el cuerpo. Antes los nombres largos de polo
  // se desbordaban del rectángulo.
  const fit = (text, boxWidth, baseSize = 24, maxLines = 2) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    const budget = Math.max(6, Math.floor((boxWidth * 100 - 24) / (baseSize * 0.56)));
    const lines = [];
    for (const word of words) {
      const current = lines.at(-1);
      if (!current || `${current} ${word}`.length > budget) lines.push(word);
      else lines[lines.length - 1] = `${current} ${word}`;
    }
    while (lines.length > maxLines) lines.splice(maxLines - 1, 2, `${lines[maxLines - 1]} ${lines[maxLines]}`);
    const longest = Math.max(1, ...lines.map((line) => line.length));
    const size = Math.min(baseSize, (boxWidth * 100 - 24) / (longest * 0.56));
    return { lines, size };
  };

  const caja = (x, y, width, height, className, entries) => {
    const left = px(x - width / 2);
    const top = py(y + height / 2);
    const rendered = entries.map((entry) => ({ ...entry, ...fit(entry.text, width, entry.size, entry.maxLines ?? 2) }));
    const total = rendered.reduce((count, entry) => count + entry.lines.length, 0);
    let cursor = y + height / 2 - 0.40 - (total - 1) * 0.145;
    const text = rendered.map((entry) => entry.lines.map((line) => {
      const element = `<text class="${entry.className}" x="${px(x)}" y="${py(cursor)}" style="font-size:${entry.size.toFixed(1)}px" text-anchor="middle">${escapeHtml(line)}</text>`;
      cursor -= 0.29;
      return element;
    }).join('')).join('');
    return `<g class="${className}"><rect x="${left}" y="${top}" width="${(width * 100).toFixed(0)}" height="${(height * 100).toFixed(0)}" rx="7"/>${text}</g>`;
  };

  const columnas = [
    ...sources.map((source, index) => ({ x: sources.length === 1 ? -2.55 : (index === 0 ? -5.1 : 0), source, className: 'unifilar-fuente' })),
    ...(alternate ? [{ x: 5.1, source: alternate, className: 'unifilar-alterna' }] : [])
  ];

  const nodos = columnas.map(({ x, source, className }) => caja(x, 3.7, 4.25, 1.18, className, [
    { text: source.label ?? '', className: 'unifilar-label', size: 27 },
    ...(source.detail ? [{ text: source.detail, className: 'unifilar-detalle', size: 22 }] : [])
  ])).join('');

  // La ruta alterna no comparte el bus: baja punteada y entra al polo por un
  // costado. Colgarla del mismo bus afirmaría una conexión que no existe.
  const enBus = columnas.filter((columna) => columna.className !== 'unifilar-alterna');
  const bajadas = enBus.map(({ x }) =>
    `<path class="unifilar-red" d="M ${px(x)} ${py(3.11)} L ${px(x)} ${py(2.15)}"/>` +
    `<rect class="unifilar-switch" x="${px(x - 0.12)}" y="${py(2.84)}" width="24" height="24"/>`).join('');

  const alterno = alternate
    ? `<path class="unifilar-red unifilar-red-alterna" d="M ${px(5.1)} ${py(3.11)} L ${px(5.1)} ${py(-0.35)} L ${px(3.25)} ${py(-0.35)}"/>` +
      `<rect class="unifilar-switch" x="${px(5.1 - 0.12)}" y="${py(2.84)}" width="24" height="24"/>`
    : '';

  const anchoBus = enBus.length ? Math.min(...enBus.map((c) => c.x)) - 0.8 : -5.9;
  const finBus = enBus.length ? Math.max(...enBus.map((c) => c.x)) + 1.25 : 1.25;
  const bus = `<path class="unifilar-bus" d="M ${px(anchoBus)} ${py(2.15)} L ${px(finBus)} ${py(2.15)}"/>` +
    `<text class="unifilar-bus-label" x="${px(anchoBus)}" y="${py(1.72)}">Ruta de interconexión eléctrica</text>`;

  const transformador = `<path class="unifilar-red" d="M ${px(0)} ${py(2.15)} L ${px(0)} ${py(1.5)}"/>` +
    `<circle class="unifilar-bobina" cx="${px(0)}" cy="${py(1.3)}" r="20"/>` +
    `<circle class="unifilar-bobina" cx="${px(0)}" cy="${py(0.82)}" r="20"/>` +
    `<path class="unifilar-red" d="M ${px(0)} ${py(0.62)} L ${px(0)} ${py(0.38)}"/>`;

  const polo = caja(0, -0.35, 6.5, 1.45, 'unifilar-polo', [
    { text: block.polo ?? '', className: 'unifilar-polo-label', size: 31, maxLines: 3 },
    ...(block.state ? [{ text: block.state, className: 'unifilar-detalle', size: 22 }] : [])
  ]);

  const posiciones = metrics.length === 3 ? [-4, 0, 4] : metrics.length === 2 ? [-2.2, 2.2] : [0];
  const reparto = metrics.length
    ? `<path class="unifilar-red" d="M ${px(0)} ${py(-1.08)} L ${px(0)} ${py(-2.05)}"/>` +
      `<path class="unifilar-red" d="M ${px(posiciones[0])} ${py(-2.05)} L ${px(posiciones.at(-1))} ${py(-2.05)}"/>` +
      posiciones.map((x) => `<path class="unifilar-red" d="M ${px(x)} ${py(-2.05)} L ${px(x)} ${py(-2.53)}"/>`).join('')
    : '';

  const cifras = metrics.map((metric, index) => caja(posiciones[index], -3.12, 3.55, 1.18,
    metric.variant === 'madura' ? 'unifilar-madura' : 'unifilar-kpi', [
      { text: metric.value ?? '', className: 'unifilar-cifra', size: 34 },
      { text: metric.label ?? '', className: 'unifilar-detalle', size: 22 }
    ])).join('');

  const descripcion = [
    columnas.map(({ source }) => `${source.label ?? ''} ${source.detail ?? ''}`.trim()).join('; '),
    block.polo ? `alimentan a ${block.polo}` : '',
    metrics.map((metric) => `${metric.label}: ${metric.value}`).join('; ')
  ].filter(Boolean).join('. ');
  const id = `unifilar-${hashText(`${block.polo ?? ''}|${descripcion}`)}`;

  return `<figure class="unifilar-figure">
    <figcaption><span>Esquema unifilar</span>${escapeHtml(block.caption ?? 'Ruta de interconexión declarada para el polo')}</figcaption>
    <svg class="unifilar" viewBox="0 0 1480 900" role="img" aria-labelledby="${id}-title ${id}-desc">
      <title id="${id}-title">Esquema unifilar de ${escapeHtml(block.polo ?? 'el polo')}</title>
      <desc id="${id}-desc">${escapeHtml(descripcion)}</desc>
      <g class="unifilar-red-grupo">${bajadas}${alterno}${bus}${transformador}${reparto}</g>
      ${nodos}${polo}${cifras}
    </svg>
  </figure>`;
}

function renderFlow(block) {
  const labels = new Map(block.nodes.map((node) => [node.id, node.label]));
  const direction = ['TD', 'BT', 'LR', 'RL'].includes(block.direction) ? block.direction : 'TD';
  const layout = layoutFlowDiagram(block.nodes, block.edges, direction);
  const diagramId = `flow-${hashText(block.nodes.map((node) => `${node.id}:${node.label}`).join('|'))}`;
  const edges = block.edges.map((edge) => {
    const source = layout.positions.get(edge.source);
    const target = layout.positions.get(edge.target);
    if (!source || !target) return '';
    return `<path class="diagram-edge" d="${flowEdgePath(source, target, direction)}" marker-end="url(#${diagramId}-arrow)" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  const nodes = block.nodes.map((node, index) => {
    const position = layout.positions.get(node.id);
    if (!position) return '';
    const lines = wrapDiagramLabel(node.label);
    const firstLineY = position.y + 31 - ((lines.length - 1) * 8);
    return `<g class="diagram-node band-${(position.band ?? 0) % 6}"><rect x="${position.x}" y="${position.y}" width="${layout.nodeWidth}" height="${layout.nodeHeight}" rx="6" vector-effect="non-scaling-stroke"/><text class="diagram-node-number" x="${position.x + 10}" y="${position.y + 15}">${String(index + 1).padStart(2, '0')}</text><text class="diagram-node-label" x="${position.x + layout.nodeWidth / 2}" y="${firstLineY}" text-anchor="middle">${lines.map((line, lineIndex) => `<tspan x="${position.x + layout.nodeWidth / 2}" dy="${lineIndex ? 16 : 0}">${escapeHtml(line)}</tspan>`).join('')}</text></g>`;
  }).join('');
  const relationText = block.edges.map((edge) => `<li>${escapeHtml(labels.get(edge.source) ?? edge.source)} → ${escapeHtml(labels.get(edge.target) ?? edge.target)}</li>`).join('');
  return `<figure class="norm-flow diagram-${direction.toLowerCase()}"><figcaption><span>Diagrama normativo</span>Relaciones declaradas en el documento fuente</figcaption><svg class="flow-diagram" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-labelledby="${diagramId}-title ${diagramId}-desc"><title id="${diagramId}-title">Diagrama de relaciones normativas</title><desc id="${diagramId}-desc">${block.nodes.length} elementos y ${block.edges.length} relaciones extraídos del bloque Mermaid del informe canónico.</desc><defs><marker id="${diagramId}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="diagram-arrow"/></marker></defs><g class="diagram-edges">${edges}</g><g class="diagram-nodes">${nodes}</g></svg><ol class="sr-only" aria-label="Relaciones del diagrama">${relationText}</ol></figure>`;
}

function layoutFlowDiagram(nodes, edges, direction) {
  const nodeWidth = 178;
  const nodeHeight = 80;
  const margin = 28;
  const levels = flowLevels(nodes, edges);
  const groups = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(node);
  }
  const orderedLevels = [...groups.keys()].sort((a, b) => a - b);
  const positions = new Map();

  if (direction === 'TD' || direction === 'BT') {
    const horizontalGap = 24;
    const verticalGap = 58;
    const widest = Math.max(...[...groups.values()].map((group) => group.length), 1);
    const width = margin * 2 + widest * nodeWidth + (widest - 1) * horizontalGap;
    const height = margin * 2 + orderedLevels.length * nodeHeight + Math.max(0, orderedLevels.length - 1) * verticalGap;
    orderedLevels.forEach((level, levelIndex) => {
      const group = groups.get(level);
      const rowWidth = group.length * nodeWidth + (group.length - 1) * horizontalGap;
      const yIndex = direction === 'BT' ? orderedLevels.length - levelIndex - 1 : levelIndex;
      group.forEach((node, nodeIndex) => positions.set(node.id, {
        x: (width - rowWidth) / 2 + nodeIndex * (nodeWidth + horizontalGap),
        y: margin + yIndex * (nodeHeight + verticalGap),
        width: nodeWidth,
        height: nodeHeight,
        band: yIndex
      }));
    });
    return { positions, width, height, nodeWidth, nodeHeight };
  }

  const columns = Math.min(4, Math.max(orderedLevels.length, 1));
  const horizontalGap = 34;
  const nodeGap = 16;
  const bandGap = 48;
  const bandCount = Math.ceil(orderedLevels.length / columns);
  const bandHeights = Array.from({ length: bandCount }, (_, band) => {
    const levelsInBand = orderedLevels.slice(band * columns, (band + 1) * columns);
    return Math.max(...levelsInBand.map((level) => groups.get(level).length), 1) * nodeHeight + Math.max(0, Math.max(...levelsInBand.map((level) => groups.get(level).length), 1) - 1) * nodeGap;
  });
  const width = margin * 2 + columns * nodeWidth + (columns - 1) * horizontalGap;
  const height = margin * 2 + bandHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, bandCount - 1) * bandGap;
  let bandTop = margin;
  for (let band = 0; band < bandCount; band += 1) {
    const levelsInBand = orderedLevels.slice(band * columns, (band + 1) * columns);
    levelsInBand.forEach((level, indexInBand) => {
      const visualColumn = band % 2 === 0 ? indexInBand : columns - indexInBand - 1;
      const group = groups.get(level);
      const groupHeight = group.length * nodeHeight + (group.length - 1) * nodeGap;
      group.forEach((node, nodeIndex) => positions.set(node.id, {
        x: margin + visualColumn * (nodeWidth + horizontalGap),
        y: bandTop + (bandHeights[band] - groupHeight) / 2 + nodeIndex * (nodeHeight + nodeGap),
        width: nodeWidth,
        height: nodeHeight,
        band
      }));
    });
    bandTop += bandHeights[band] + bandGap;
  }
  if (direction === 'RL') {
    for (const position of positions.values()) position.x = width - margin - nodeWidth - (position.x - margin);
  }
  return { positions, width, height, nodeWidth, nodeHeight };
}

function flowLevels(nodes, edges) {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    indegree.set(edge.target, indegree.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  }
  const levels = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const visited = new Set();
  while (queue.length) {
    const source = queue.shift();
    visited.add(source);
    for (const target of outgoing.get(source) ?? []) {
      levels.set(target, Math.max(levels.get(target), levels.get(source) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  for (const node of nodes) if (!visited.has(node.id)) levels.set(node.id, 0);
  return levels;
}

function flowEdgePath(source, target, direction) {
  if ((direction === 'TD' || direction === 'BT') && source.band !== target.band) {
    const downward = target.y > source.y;
    const startY = downward ? source.y + source.height : source.y;
    const endY = downward ? target.y : target.y + target.height;
    const middleY = (startY + endY) / 2;
    return `M ${source.x + source.width / 2} ${startY} C ${source.x + source.width / 2} ${middleY}, ${target.x + target.width / 2} ${middleY}, ${target.x + target.width / 2} ${endY}`;
  }
  if (source.band === target.band) {
    const rightward = target.x > source.x;
    const startX = rightward ? source.x + source.width : source.x;
    const endX = rightward ? target.x : target.x + target.width;
    const middleX = (startX + endX) / 2;
    return `M ${startX} ${source.y + source.height / 2} C ${middleX} ${source.y + source.height / 2}, ${middleX} ${target.y + target.height / 2}, ${endX} ${target.y + target.height / 2}`;
  }
  const startY = source.y + source.height;
  const endY = target.y;
  const middleY = (startY + endY) / 2;
  return `M ${source.x + source.width / 2} ${startY} C ${source.x + source.width / 2} ${middleY}, ${target.x + target.width / 2} ${middleY}, ${target.x + target.width / 2} ${endY}`;
}

function wrapDiagramLabel(value, maximum = 24) {
  const words = String(value).split(/\s+/).filter(Boolean);
  const lines = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > maximum) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length <= 4) return lines;
  return [lines[0], lines[1], lines[2], lines.slice(3).join(' ')];
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function renderSourceProfile(sources) {
  const counts = new Map();
  for (const source of sources) {
    const host = new URL(source.url).hostname.replace(/^www\./, '');
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  const entries = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) return '';
  const maximum = entries[0][1];
  return `<section class="source-profile"><div class="chart-heading"><div><p class="eyebrow">Gráfica 01 · cobertura documental</p><h2>Perfil de fuentes</h2></div><p>Distribución de los enlaces oficiales incluidos en el contrato publicable, agrupados por dominio.</p></div><div class="source-bars">${entries.map(([host, count]) => `<div><span>${escapeHtml(host)}</span><i><b style="width:${Math.max(4, Math.round(count / maximum * 100))}%"></b></i><strong>${count}</strong></div>`).join('')}</div><p class="chart-source">Fuente: elaboración del informe a partir de ${sources.length} enlaces del contrato validado.</p></section>`;
}

function renderClosing(section, contract, manifest) {
  const blocks = section?.blocks?.length ? section.blocks : [{ type: 'paragraph', text: 'Edición preparada para consulta y verificación documental.' }];
  const narrative = `<section class="report-closing narrative-closing">
    <div class="closing-head">
      <p class="cover-kicker"><i></i> Corte ${escapeHtml(contract.cutoff)} · <span class="mono">${escapeHtml(manifest.release_id)}</span></p>
      <img class="closing-mark" src="/assets/sener-logo.png" alt="Secretaría de Energía">
    </div>
    <div class="closing-narrative">
      <h2>${escapeHtml(section?.title || 'Fin de la edición')}</h2>
      <div class="institutional-separator gold" aria-hidden="true"><i></i><b></b><i></i></div>
      <div class="closing-copy">${blocks.map(renderBlock).join('')}</div>
    </div>
    <div class="closing-signature">
      <div><strong>DGMESNIE</strong><span>Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética</span></div>
      <div><b>Subsecretaría de Planeación y Transición Energética</b><small>Secretaría de Energía · Gobierno de México</small></div>
      <img class="year-lockup" src="/assets/lema-margarita-2026.png" alt="2026, año de Margarita Maza">
    </div>
  </section>`;
  return `${narrative}<section class="report-back-cover" aria-labelledby="gracias-title"><div class="back-cover-logos"><img src="/assets/gobierno-mexico-logo.png" alt="Gobierno de México"><img src="/assets/sener-logo.png" alt="Secretaría de Energía"></div><div class="back-cover-main"><img class="back-cover-woman" src="/assets/mujer.png" alt="Ilustración institucional de una mujer portando la bandera de México"><div><p class="eyebrow">Secretaría de Energía</p><h2 id="gracias-title">Gracias</h2><p>Subsecretaría de Planeación y Transición Energética</p><strong>Dirección General de Metodologías y Estadísticas del Sistema Nacional de Información Energética</strong></div></div><div class="back-cover-bottom"><div><span>DGMESNIE</span><small>Corte ${escapeHtml(contract.cutoff)} · ${escapeHtml(manifest.release_id)}</small></div><div class="qr-lockup"><div class="qr-code" data-qr-path="/informes/${escapeHtml(contract.slug)}/" aria-label="Código QR para abrir la última versión del informe"><a href="/informes/${escapeHtml(contract.slug)}/">Abrir informe</a></div><p>Consulte la edición web</p></div></div></section>`;
}

function normalizeText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function pageShell({ title, description = '', canonicalPath, canonicalHref = canonicalPath, body, scripts = [] }) {
  const extras = scripts.map((src) => `<script src="${escapeHtml(src)}" defer></script>`).join('');
  // Todo el JavaScript se sirve desde el propio origen: el exportador de PDF
  // bloquea cualquier recurso externo y el sitio no debe depender de un CDN.
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonicalHref)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/styles.css"><script src="/assets/qrcode.js" defer></script>${extras}<script src="/assets/paginate.js" defer></script><script src="/assets/app.js" defer></script><title>${escapeHtml(title)} · Informes DGMESNIE</title></head><body>${body}</body></html>`;
}
