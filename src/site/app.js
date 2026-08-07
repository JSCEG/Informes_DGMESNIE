document.documentElement.classList.add('js');

// La composición por hojas se mide antes de abrir el lector: el índice, los
// folios y la exportación a PDF dependen del conteo definitivo de hojas.
window.reportReady = (window.reportPagination?.run() ?? Promise.resolve(null))
  .catch((error) => {
    console.warn('La paginación medida falló; se conserva el flujo continuo.', error);
    return null;
  })
  .then(startReader);

function startReader() {
const reportMain = document.querySelector('.editorial-cover')?.closest('main');
// El panel de versión es cáscara web, no una hoja del documento: la
// contraportada debe cerrar tanto el libro como el PDF.
const pageCandidates = reportMain ? [...reportMain.querySelectorAll(':scope > .editorial-cover, :scope > .report-toc, :scope > .report-content > .chapter-opener, :scope > .report-content > .report-section, :scope > .source-profile, :scope > .sources, :scope > .report-closing, :scope > .report-back-cover')] : [];
const pageIndicator = document.querySelector('[data-page-indicator]');
const zoomIndicator = document.querySelector('[data-zoom-indicator]');
const viewButton = document.querySelector('[data-reader-action="view"]');
const previousButton = document.querySelector('[data-reader-action="previous"]');
const nextButton = document.querySelector('[data-reader-action="next"]');
const readingProgress = document.querySelector('[data-reading-progress]');
const desktopQuery = matchMedia('(min-width: 761px)');
const spreadQuery = matchMedia('(min-width: 1180px)');
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let activePage = 0;
let zoom = 1;
let preferredMode = pageCandidates.length ? 'paged' : 'continuous';
let mode = preferredMode;
let turnAnimation;
let isTurning = false;

for (const [index, page] of pageCandidates.entries()) {
  page.classList.add('reader-page');
  page.dataset.page = String(index + 1);
  page.dataset.pageLabel = `${index + 1} / ${pageCandidates.length}`;
  const folio = document.createElement('footer');
  folio.className = 'page-folio';
  folio.setAttribute('aria-label', `DGMESNIE, hoja ${index + 1} de ${pageCandidates.length}`);
  folio.innerHTML = `<span>DGMESNIE</span><span>${index + 1} / ${pageCandidates.length}</span>`;
  page.append(folio);
}

function targetForHash(hash = '') {
  if (!hash.startsWith('#')) return null;
  return document.getElementById(decodeURIComponent(hash.slice(1)));
}

function pageForTarget(target) {
  if (!target) return -1;
  const page = target.classList.contains('reader-page') ? target : target.closest('.reader-page');
  return pageCandidates.indexOf(page);
}

for (const link of document.querySelectorAll('.report-toc a[href^="#"], .document-index a[href^="#"]')) {
  const target = targetForHash(link.getAttribute('href'));
  const index = pageForTarget(target);
  const leaf = link.querySelector('em');
  if (leaf && index >= 0) leaf.textContent = String(index + 1).padStart(2, '0');
}

function visiblePageIndexes(index = activePage) {
  if (!spreadQuery.matches) return [Math.max(0, Math.min(pageCandidates.length - 1, index))];
  if (index <= 0) return [0];
  const start = index % 2 === 1 ? index : index - 1;
  return [start, start + 1].filter((pageIndex) => pageIndex < pageCandidates.length);
}

function pageIndicatorText(indexes) {
  if (indexes.length < 2) return `Hoja ${indexes[0] + 1} de ${pageCandidates.length}`;
  return `Hojas ${indexes[0] + 1}–${indexes[1] + 1} de ${pageCandidates.length}`;
}

function fitZoom() {
  const pageWidth = 816;
  const pageHeight = 1056;
  const sheetCount = spreadQuery.matches ? 2 : 1;
  const available = Math.max(420, innerWidth - (sheetCount === 2 ? 64 : 80));
  const availableHeight = Math.max(580, innerHeight - 144);
  return Math.min(1, Math.max(.55, Math.min(available / (pageWidth * sheetCount), availableHeight / pageHeight)));
}

function updateProgress(indexes = visiblePageIndexes()) {
  if (!readingProgress) return;
  if (mode === 'paged' && desktopQuery.matches) {
    const lastVisible = indexes[indexes.length - 1] ?? 0;
    readingProgress.style.width = `${pageCandidates.length > 1 ? lastVisible / (pageCandidates.length - 1) * 100 : 100}%`;
    return;
  }
  const maximum = document.documentElement.scrollHeight - innerHeight;
  readingProgress.style.width = `${maximum > 0 ? Math.min(100, Math.max(0, scrollY / maximum * 100)) : 0}%`;
}

function updateReaderControls() {
  const paged = mode === 'paged' && desktopQuery.matches;
  const indexes = paged ? visiblePageIndexes() : [];
  document.body.classList.toggle('reader-paged', paged);
  document.body.classList.toggle('reader-spread', paged && spreadQuery.matches && indexes.length === 2);
  document.body.classList.toggle('reader-continuous', !paged && Boolean(reportMain));

  pageCandidates.forEach((page, index) => {
    const visible = !paged || indexes.includes(index);
    page.hidden = !visible;
    page.classList.toggle('is-active', paged && visible);
    page.classList.toggle('book-page-left', paged && indexes.length === 2 && index === indexes[0]);
    page.classList.toggle('book-page-right', paged && indexes.length === 2 && index === indexes[1]);
    page.classList.toggle('book-page-solo', paged && indexes.length === 1 && index === indexes[0]);
    page.style.zoom = paged ? String(zoom) : '';
  });

  const atEnd = paged && indexes[indexes.length - 1] === pageCandidates.length - 1;
  if (pageIndicator) pageIndicator.textContent = paged ? (atEnd ? `Contraportada · ${pageIndicatorText(indexes)}` : pageIndicatorText(indexes)) : 'Lectura continua';
  if (zoomIndicator) zoomIndicator.textContent = `${Math.round(zoom * 100)}%`;
  if (viewButton) {
    viewButton.textContent = paged ? 'Lectura continua' : 'Modo libro';
    viewButton.setAttribute('aria-pressed', String(paged));
  }
  if (previousButton) previousButton.disabled = !paged || indexes[0] === 0;
  if (nextButton) {
    nextButton.disabled = !paged || atEnd;
    nextButton.setAttribute('aria-label', atEnd ? 'Fin del informe' : 'Página siguiente');
    nextButton.title = atEnd ? 'Fin del informe' : '';
  }
  updateProgress(indexes);
}

async function showPage(index, { scroll = true, direction = 0 } = {}) {
  if (!pageCandidates.length || isTurning) return;
  const previousIndexes = visiblePageIndexes();
  const nextPage = Math.max(0, Math.min(pageCandidates.length - 1, index));
  const previousPage = activePage;
  activePage = nextPage;
  const nextIndexes = visiblePageIndexes(nextPage);
  activePage = previousPage;
  const inferredDirection = direction || Math.sign(nextIndexes[0] - previousIndexes[0]);
  if (!inferredDirection || reducedMotionQuery.matches || mode !== 'paged' || !desktopQuery.matches) {
    activePage = nextPage;
    updateReaderControls();
  } else {
    isTurning = true;
    document.body.classList.add('is-page-turning');
    const outgoingIndex = inferredDirection > 0 ? previousIndexes[previousIndexes.length - 1] : previousIndexes[0];
    const outgoing = pageCandidates[outgoingIndex];
    const outgoingOrigin = inferredDirection > 0 ? 'left center' : 'right center';
    const outgoingAngle = inferredDirection > 0 ? '-92deg' : '92deg';
    outgoing.style.transformOrigin = outgoingOrigin;
    turnAnimation = outgoing.animate([
      { transform: 'perspective(2400px) rotateY(0deg)', filter: 'brightness(1)', boxShadow: '0 14px 34px rgba(0,0,0,.29)' },
      { transform: `perspective(2400px) rotateY(${outgoingAngle})`, filter: 'brightness(.48)', boxShadow: '0 24px 58px rgba(0,0,0,.56)' }
    ], { duration: 380, easing: 'cubic-bezier(.55,.02,.78,.44)', fill: 'both' });
    await turnAnimation.finished.catch(() => {});
    activePage = nextPage;
    updateReaderControls();
    turnAnimation.cancel();
    outgoing.style.transformOrigin = '';

    const incomingIndex = inferredDirection > 0 ? nextIndexes[0] : nextIndexes[nextIndexes.length - 1];
    const incoming = pageCandidates[incomingIndex];
    const incomingOrigin = inferredDirection > 0 ? 'right center' : 'left center';
    const incomingAngle = inferredDirection > 0 ? '92deg' : '-92deg';
    incoming.style.transformOrigin = incomingOrigin;
    turnAnimation = incoming.animate([
      { transform: `perspective(2400px) rotateY(${incomingAngle})`, filter: 'brightness(.5)', boxShadow: '0 24px 58px rgba(0,0,0,.54)' },
      { transform: 'perspective(2400px) rotateY(0deg)', filter: 'brightness(1)', boxShadow: '0 14px 34px rgba(0,0,0,.29)' }
    ], { duration: 380, easing: 'cubic-bezier(.18,.62,.28,1)', fill: 'both' });
    await turnAnimation.finished.catch(() => {});
    turnAnimation.cancel();
    incoming.style.transformOrigin = '';
    turnAnimation = null;
    isTurning = false;
    document.body.classList.remove('is-page-turning');
  }
  if (scroll && reportMain) {
    const top = reportMain.getBoundingClientRect().top + scrollY;
    scrollTo({ top, behavior: reducedMotionQuery.matches ? 'auto' : 'smooth' });
  }
}

function turnSpread(direction) {
  const indexes = visiblePageIndexes();
  if (direction > 0 && indexes[indexes.length - 1] >= pageCandidates.length - 1) return;
  if (direction < 0 && indexes[0] <= 0) return;
  const target = direction > 0 ? indexes[indexes.length - 1] + 1 : indexes[0] - 1;
  showPage(target, { direction });
}

function fitPage() {
  zoom = fitZoom();
  updateReaderControls();
}

function applyResponsiveMode() {
  mode = desktopQuery.matches ? preferredMode : 'continuous';
  if (mode === 'paged') zoom = fitZoom();
  else zoom = 1;
  updateReaderControls();
}

for (const anchor of document.querySelectorAll('a[href^="#"]')) {
  anchor.addEventListener('click', (event) => {
    const target = targetForHash(anchor.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    if (mode === 'paged' && desktopQuery.matches) {
      const index = pageForTarget(target);
      if (index >= 0) showPage(index);
    } else {
      target.scrollIntoView({ behavior: reducedMotionQuery.matches ? 'auto' : 'smooth' });
    }
  });
}

previousButton?.addEventListener('click', () => turnSpread(-1));
nextButton?.addEventListener('click', () => turnSpread(1));
viewButton?.addEventListener('click', () => {
  preferredMode = preferredMode === 'paged' ? 'continuous' : 'paged';
  mode = preferredMode;
  if (mode === 'paged') {
    const targetPage = pageForTarget(targetForHash(location.hash));
    if (targetPage >= 0) activePage = targetPage;
    zoom = fitZoom();
  }
  updateReaderControls();
});

document.querySelector('[data-reader-action="zoom-out"]')?.addEventListener('click', () => {
  zoom = Math.max(.55, Number((zoom - .1).toFixed(2)));
  updateReaderControls();
});
document.querySelector('[data-reader-action="zoom-in"]')?.addEventListener('click', () => {
  zoom = Math.min(1.3, Number((zoom + .1).toFixed(2)));
  updateReaderControls();
});
document.querySelector('[data-reader-action="fit"]')?.addEventListener('click', fitPage);

const fullscreenButton = document.querySelector('[data-reader-action="fullscreen"]');
fullscreenButton?.addEventListener('click', async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  else await document.exitFullscreen?.();
});
document.addEventListener('fullscreenchange', () => {
  if (fullscreenButton) fullscreenButton.textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
  if (mode === 'paged') fitPage();
});

// Al imprimir, las hojas se clonan y las originales quedan ocultas pero vivas en
// el DOM. Con el identificador duplicado, el navegador resuelve cada `#ancla` a
// la copia oculta y el PDF sale sin un solo destino interno: el índice deja de
// ser navegable. Mientras exista el árbol de impresión, los identificadores
// viven sólo en él.
function stashReaderIds() {
  if (!reportMain) return;
  for (const element of reportMain.querySelectorAll('[id]')) {
    element.dataset.readerId = element.id;
    element.removeAttribute('id');
  }
}

function restoreReaderIds() {
  if (!reportMain) return;
  for (const element of reportMain.querySelectorAll('[data-reader-id]')) {
    element.id = element.dataset.readerId;
    delete element.dataset.readerId;
  }
}

function buildPrintRoot() {
  document.getElementById('pdf-print-root')?.remove();
  restoreReaderIds();
  const root = document.createElement('div');
  root.id = 'pdf-print-root';
  root.className = reportMain?.classList.contains('model-report') ? 'model-report model-pages' : '';
  for (const page of pageCandidates) {
    const clone = page.cloneNode(true);
    clone.hidden = false;
    clone.style.zoom = '1';
    clone.classList.remove('is-active', 'book-page-left', 'book-page-right', 'book-page-solo');
    root.append(clone);
  }
  document.body.append(root);
  stashReaderIds();
}

function preparePrintLayout({ clone = true } = {}) {
  if (!pageCandidates.length) return;
  document.body.classList.add('pdf-export');
  pageCandidates.forEach((page) => {
    page.hidden = false;
    page.style.zoom = '1';
  });
  document.querySelectorAll('.map-popup').forEach((popup) => { popup.hidden = true; });
  if (clone) buildPrintRoot();
}

function restoreReaderAfterPrint() {
  if (window.__pdfExporting) return;
  document.getElementById('pdf-print-root')?.remove();
  restoreReaderIds();
  document.body.classList.remove('pdf-export');
  updateReaderControls();
}

window.prepareReportPrint = preparePrintLayout;
addEventListener('beforeprint', preparePrintLayout);
addEventListener('afterprint', restoreReaderAfterPrint);
document.querySelector('[data-reader-action="print"]')?.addEventListener('click', () => {
  preparePrintLayout({ clone: false });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    preparePrintLayout();
    window.print();
  }));
});

addEventListener('scroll', () => {
  if (mode !== 'paged') updateProgress();
}, { passive: true });

addEventListener('keydown', (event) => {
  if (mode !== 'paged' || !desktopQuery.matches || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') turnSpread(-1);
  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault();
    turnSpread(1);
  }
});

desktopQuery.addEventListener('change', applyResponsiveMode);
spreadQuery.addEventListener('change', applyResponsiveMode);
addEventListener('resize', () => {
  if (mode === 'paged') fitPage();
  else updateProgress();
});

function syncPageFromHash() {
  if (!location.hash || mode !== 'paged' || !desktopQuery.matches) return;
  const targetPage = pageForTarget(targetForHash(location.hash));
  if (targetPage >= 0) {
    activePage = targetPage;
    updateReaderControls();
  }
}

if (location.hash) {
  const targetPage = pageForTarget(targetForHash(location.hash));
  if (targetPage >= 0) activePage = targetPage;
}
addEventListener('hashchange', syncPageFromHash);
applyResponsiveMode();
requestAnimationFrame(syncPageFromHash);

for (const container of document.querySelectorAll('[data-qr-path]')) {
  if (typeof window.qrcode !== 'function') continue;
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(new URL(container.dataset.qrPath, location.origin).href);
    qr.make();
    container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
  } catch {
    // El enlace de texto permanece como alternativa accesible si la biblioteca no carga.
  }
}
}
