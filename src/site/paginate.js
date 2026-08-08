/*
 * Paginador editorial medido.
 *
 * El servidor entrega un flujo semántico de temas (`[data-topic]`) más las
 * hojas atómicas (aperturas de capítulo y diagramas). Aquí se componen hojas
 * carta reales: cada bloque se coloca y se mide contra la caja impresa, y sólo
 * se abre una hoja nueva cuando el contenido deja de caber. Sustituye a la
 * estimación por pesos, que subllenaba y recortaba hojas.
 */
(() => {
  const flow = document.querySelector('.report-content[data-paginate]');
  window.reportPagination = { run: () => Promise.resolve(null) };
  if (!flow) return;

  const cutoff = flow.dataset.cutoff || '';
  const oversized = [];
  let stage = null;
  let sheets = [];
  let current = null;
  let currentTopic = null;

  const overflows = () => Boolean(current) && current.sheet.scrollHeight > current.sheet.clientHeight;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function runningHead(number, title) {
    const head = element('div', 'chapter-running-head');
    const link = element('a', null, `${number ? `${number} · ` : ''}${title}`);
    link.href = '#contenido';
    head.append(link, element('span', null, cutoff ? `Corte ${cutoff}` : ''));
    return head;
  }

  function openSheet(meta) {
    // `paginated-sheet` marca las hojas compuestas por medición: sólo entre
    // ellas tiene sentido exigir que la caja quede aprovechada.
    const sheet = element('section', `report-section paginated-sheet reader-page level-${meta.level}`);
    const body = element('div', 'section-body');
    if (meta.chapterTitle) body.append(runningHead(meta.chapterNumber, meta.chapterTitle));
    const list = element('div', 'packed-topic-list');
    body.append(list);
    sheet.append(element('div', 'section-number', meta.chapterNumber || meta.number || ''), body);
    stage.append(sheet);
    sheets.push(sheet);
    current = { sheet, body, list };
    currentTopic = null;
  }

  function openTopic(meta, { continued = false } = {}) {
    if (!current) openSheet(meta);
    meta.parts += 1;
    const article = element('article', `packed-topic level-${meta.level}`);
    article.id = continued ? `${meta.id}-continuacion-${meta.parts}` : meta.id;
    if (continued) article.classList.add('topic-continued');
    const heading = element('div', 'packed-topic-heading');
    const title = element('h2', null, meta.title);
    if (continued) {
      const mark = element('span', 'topic-continued-mark', ' (cont.)');
      mark.setAttribute('aria-hidden', 'true');
      title.append(mark, element('span', 'sr-only', ', continuación'));
    }
    heading.append(element('span', null, meta.number), title);
    article.append(heading);
    current.list.append(article);
    currentTopic = { article, meta };
    // Un encabezado que no cabe indica que la hoja anterior ya estaba llena.
    if (overflows() && current.list.children.length > 1) {
      article.remove();
      meta.parts -= 1;
      current = null;
      openSheet(meta);
      openTopic(meta, { continued });
    }
  }

  function startContinuation(meta) {
    current = null;
    openSheet(meta);
    openTopic(meta, { continued: true });
  }

  // Un encabezado suelto al pie de la hoja viaja con el bloque que lo sigue.
  function takeTrailingHeading() {
    const last = currentTopic?.article.lastElementChild;
    if (!last) return null;
    if (!['H3', 'H4'].includes(last.tagName) && !last.classList.contains('eyebrow')) return null;
    last.remove();
    return last;
  }

  function placeBlock(node, meta) {
    currentTopic.article.append(node);
    if (!overflows()) return;

    const tail = splitNode(node);
    if (tail) {
      startContinuation(meta);
      placeBlock(tail, meta);
      return;
    }

    // Ya estaba solo en una hoja limpia: no hay espacio que recuperar.
    const isolated = currentTopic.article.children.length <= 2 && current.list.children.length === 1;
    if (isolated) {
      oversized.push({ topic: meta.id, block: node.className || node.tagName.toLowerCase() });
      return;
    }

    node.remove();
    // Si el tema aún no había colocado nada, su encabezado quedaría solo al pie
    // y la hoja siguiente diría "continuación" sin que hubiera qué continuar.
    // El tema entero se muda y arranca limpio.
    if (currentTopic.article.children.length === 1) {
      currentTopic.article.remove();
      meta.parts -= 1;
      current = null;
      openSheet(meta);
      openTopic(meta);
      placeBlock(node, meta);
      return;
    }

    // En una hoja limpia el bloque suele volverse partible.
    const orphan = takeTrailingHeading();
    startContinuation(meta);
    if (orphan) currentTopic.article.append(orphan);
    placeBlock(node, meta);
  }

  function splitNode(node) {
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      return splitByChildren(node, node, () => node.cloneNode(false));
    }
    // La ficha de polo es un bloque largo pero divisible: sus secciones pueden
    // continuar en la hoja siguiente en vez de desbordar.
    if (node.classList.contains('timeline') || node.classList.contains('metrics-grid')
      || node.classList.contains('process-sequence') || node.classList.contains('polo-ficha')) {
      return splitByChildren(node, node, () => node.cloneNode(false));
    }
    if (node.classList.contains('table-figure')) return splitTableFigure(node);
    if (node.tagName === 'P' || node.tagName === 'BLOCKQUOTE') {
      const target = node.tagName === 'P' ? node : node.querySelector('p');
      return target ? splitByText(node, target, (clone) => (clone.tagName === 'P' ? clone : clone.querySelector('p'))) : null;
    }
    if (node.classList.contains('callout')) {
      const target = node.querySelector('p');
      return target ? splitByText(node, target, (clone) => clone.querySelector('p')) : null;
    }
    return null;
  }

  function splitByChildren(node, container, makeTail, tailContainerOf = (tail) => tail) {
    if (container.children.length < 2) return null;
    const removed = [];
    while (container.children.length > 1 && overflows()) {
      const last = container.lastElementChild;
      last.remove();
      removed.unshift(last);
    }
    if (overflows()) {
      container.append(...removed);
      return null;
    }
    if (!removed.length) return null;
    const tail = makeTail();
    tailContainerOf(tail).append(...removed);
    return tail;
  }

  function splitTableFigure(figure) {
    const body = figure.querySelector('tbody');
    if (!body) return null;
    const tail = splitByChildren(figure, body, () => {
      const clone = figure.cloneNode(true);
      const caption = clone.querySelector('figcaption');
      if (caption && !caption.textContent.includes('continuación')) caption.append(document.createTextNode(' · continuación'));
      clone.querySelector('tbody').replaceChildren();
      return clone;
    }, (clone) => clone.querySelector('tbody'));
    return tail;
  }

  function splitByText(node, target, targetOf) {
    const full = target.textContent;
    const sentences = full.match(/[^.!?;]+(?:[.!?;]+|$)/g);
    if (!sentences || sentences.length < 2) return null;
    let low = 1;
    let high = sentences.length - 1;
    let best = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      target.textContent = sentences.slice(0, middle).join('').trim();
      if (overflows()) high = middle - 1;
      else {
        best = middle;
        low = middle + 1;
      }
    }
    if (!best) {
      target.textContent = full;
      return null;
    }
    target.textContent = sentences.slice(0, best).join('').trim();
    const tail = node.cloneNode(true);
    targetOf(tail).textContent = sentences.slice(best).join('').trim();
    return tail;
  }

  // Listas largas fuera del flujo de capítulos (fuentes): misma medición, pero
  // la hoja se replica desde su propia cáscara y conserva el conteo real.
  function paginateFlowList(section) {
    const list = section.querySelector('ol, ul');
    if (!list) return [section];
    const items = [...list.children];
    const label = section.dataset.flowLabel || '';
    // Si la sección declara dónde va el contador, ninguna otra línea se pisa.
    const hasCounter = Boolean(section.querySelector('[data-flow-counter]'));
    const built = [];
    let sheet = null;
    let target = null;

    const openListSheet = () => {
      sheet = section.cloneNode(true);
      sheet.removeAttribute('data-flow-list');
      sheet.classList.add('reader-page');
      if (built.length) {
        // Continuación: sin cabecera de apertura, con su propia etiqueta.
        sheet.classList.add('continuation-sheet');
        sheet.removeAttribute('id');
        sheet.querySelector('[data-flow-deck]')?.remove();
        sheet.querySelector('h2')?.remove();
      } else {
        sheet.querySelector('[data-flow-continued]')?.remove();
      }
      target = sheet.querySelector('ol, ul');
      target.replaceChildren();
      stage.append(sheet);
      built.push(sheet);
    };
    const listOverflows = () => sheet.scrollHeight > sheet.clientHeight;

    openListSheet();
    for (const item of items) {
      target.append(item);
      if (listOverflows() && target.children.length > 1) {
        item.remove();
        openListSheet();
        target.append(item);
      }
    }
    built.forEach((page, index) => {
      const counter = hasCounter ? page.querySelector('[data-flow-counter]') : page.querySelector('.eyebrow');
      if (counter && label) counter.textContent = `${label} · ${String(index + 1).padStart(2, '0')} / ${String(built.length).padStart(2, '0')}`;
    });
    const parent = section.parentNode;
    const anchor = section.nextSibling;
    for (const page of built) parent.insertBefore(page, anchor);
    section.remove();
    return built;
  }

  function paginate() {
    const items = [...flow.children];
    stage = element('div', 'pagination-stage');
    document.querySelector('main').append(stage);
    sheets = [];
    current = null;
    currentTopic = null;

    for (const item of items) {
      if (!item.hasAttribute('data-topic')) {
        current = null;
        currentTopic = null;
        stage.append(item);
        sheets.push(item);
        continue;
      }
      const meta = {
        id: item.id,
        number: item.dataset.number || '',
        title: item.dataset.title || '',
        level: Number(item.dataset.level) || 2,
        chapterNumber: item.dataset.chapterNumber || '',
        chapterTitle: item.dataset.chapterTitle || '',
        parts: 0
      };
      const blocks = [...item.children].filter((child) => !child.classList.contains('packed-topic-heading'));
      openTopic(meta);
      for (const block of blocks) placeBlock(block, meta);
      item.remove();
    }

    flow.replaceChildren(...sheets);
    let listSheets = 0;
    for (const section of document.querySelectorAll('main [data-flow-list]')) {
      listSheets += paginateFlowList(section).length;
    }
    stage.remove();
    stage = null;
    return { sheets: sheets.length + listSheets, oversized };
  }

  window.reportPagination = {
    run: async () => {
      const root = document.documentElement;
      const restorePaged = document.body.classList.contains('reader-paged');
      root.classList.add('is-paginating');
      document.body.classList.add('reader-paged');
      try {
        await document.fonts.ready;
        const report = paginate();
        window.reportPaginationReport = report;
        return report;
      } finally {
        if (!restorePaged) document.body.classList.remove('reader-paged');
        root.classList.remove('is-paginating');
      }
    }
  };
})();
