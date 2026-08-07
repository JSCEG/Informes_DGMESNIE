(() => {
  const palette = ['#9B2247', '#E0A12E', '#0E8A6E', '#1E9CB8'];
  const common = {
    animationDuration: 520,
    textStyle: { fontFamily: 'Noto Sans, sans-serif', color: '#1c1b1a' },
    tooltip: { backgroundColor: '#fff', borderColor: '#ece8e2', borderWidth: 1, textStyle: { color: '#1c1b1a' } },
    grid: { left: 8, right: 18, top: 26, bottom: 28, containLabel: true }
  };

  const barElement = document.getElementById('model-bar-chart');
  if (barElement && window.echarts) {
    const chart = window.echarts.init(barElement, null, { renderer: 'svg' });
    chart.setOption({
      ...common,
      xAxis: { type: 'category', data: ['A', 'B', 'C', 'D'], axisTick: { show: false }, axisLine: { lineStyle: { color: '#d8d2ca' } } },
      yAxis: { type: 'value', name: 'MW', splitLine: { lineStyle: { color: '#ece8e2', type: 'dashed' } } },
      series: [{ type: 'bar', data: [146, 102, 75, 44], itemStyle: { color: palette[0], borderRadius: [3, 3, 0, 0] }, barWidth: '52%' }]
    });
    new ResizeObserver(() => chart.resize()).observe(barElement);
  }

  const lineElement = document.getElementById('model-line-chart');
  if (lineElement && window.echarts) {
    const chart = window.echarts.init(lineElement, null, { renderer: 'svg' });
    chart.setOption({
      ...common,
      color: palette,
      legend: { bottom: 0, data: ['Serie A', 'Serie B'] },
      xAxis: { type: 'category', data: ['P1', 'P2', 'P3', 'P4', 'P5'], axisTick: { show: false }, axisLine: { lineStyle: { color: '#d8d2ca' } } },
      yAxis: { type: 'value', name: 'Índice', splitLine: { lineStyle: { color: '#ece8e2', type: 'dashed' } } },
      series: [
        { name: 'Serie A', type: 'line', smooth: true, symbolSize: 7, data: [42, 58, 55, 73, 81], lineStyle: { width: 3 } },
        { name: 'Serie B', type: 'line', smooth: true, symbolSize: 7, data: [36, 41, 52, 61, 69], lineStyle: { width: 3 } }
      ]
    });
    new ResizeObserver(() => chart.resize()).observe(lineElement);
  }

  const mixedElement = document.getElementById('model-mixed-chart');
  if (mixedElement && window.echarts) {
    const chart = window.echarts.init(mixedElement, null, { renderer: 'svg' });
    chart.setOption({
      ...common,
      color: [palette[0], palette[1], palette[3]],
      legend: { top: 0, data: ['Capacidad', 'Demanda', 'Referencia'] },
      tooltip: { ...common.tooltip, trigger: 'axis' },
      toolbox: { right: 4, feature: { saveAsImage: { title: 'Guardar imagen' }, restore: { title: 'Restablecer' } } },
      grid: { left: 12, right: 16, top: 58, bottom: 42, containLabel: true },
      xAxis: { type: 'category', data: ['2022', '2023', '2024', '2025', '2026'], axisTick: { show: false } },
      yAxis: [
        { type: 'value', name: 'Índice', min: 0, splitLine: { lineStyle: { color: '#ece8e2', type: 'dashed' } } },
        { type: 'value', name: 'Referencia', min: 60, max: 100, splitLine: { show: false } }
      ],
      series: [
        { name: 'Capacidad', type: 'bar', data: [62, 71, 83, 91, 104], barWidth: '34%', itemStyle: { borderRadius: [3, 3, 0, 0] } },
        { name: 'Demanda', type: 'line', smooth: true, data: [58, 65, 75, 80, 92], symbolSize: 7, areaStyle: { opacity: .12 }, lineStyle: { width: 3 } },
        { name: 'Referencia', type: 'line', yAxisIndex: 1, data: [76, 79, 82, 86, 89], symbol: 'none', lineStyle: { width: 2, type: 'dashed' } }
      ]
    });
    new ResizeObserver(() => chart.resize()).observe(mixedElement);
  }

  const mapElement = document.getElementById('model-gcr-map');
  if (mapElement && window.GCR_PATHS) {
    let regions = {};
    try { regions = JSON.parse(mapElement.dataset.regions || '{}'); } catch { regions = {}; }
    const entries = Object.entries(window.GCR_PATHS).filter(([key]) => regions[key]);
    const paths = entries.map(([key, path]) => `<path tabindex="0" role="button" aria-label="${regions[key].label}, ${regions[key].value} megawatts ilustrativos" data-region="${key}" d="${path}" fill="${regions[key].color}"/>`).join('');
    mapElement.innerHTML = `<svg viewBox="0 0 1000 626.3" aria-hidden="true">${paths}</svg><div class="map-popup" role="status" aria-live="polite" hidden><button type="button" aria-label="Cerrar ficha">×</button><b></b><span></span><small>Dato ilustrativo</small></div>`;
    const detail = document.getElementById('model-map-detail');
    const popup = mapElement.querySelector('.map-popup');
    const showPopup = (path, point) => {
      const region = regions[path.dataset.region];
      const bounds = mapElement.getBoundingClientRect();
      const pathBounds = path.getBoundingClientRect();
      popup.querySelector('b').textContent = region.label;
      popup.querySelector('span').textContent = `${region.value.toLocaleString('es-MX')} MW`;
      popup.style.left = `${Math.max(86, Math.min(bounds.width - 86, (point?.clientX ?? pathBounds.left + pathBounds.width / 2) - bounds.left))}px`;
      popup.style.top = `${Math.max(70, Math.min(bounds.height - 54, (point?.clientY ?? pathBounds.top + pathBounds.height / 2) - bounds.top))}px`;
      popup.hidden = false;
    };
    const select = (path, point) => {
      mapElement.querySelectorAll('path').forEach((item) => item.classList.toggle('is-selected', item === path));
      const region = regions[path.dataset.region];
      detail.innerHTML = `<b>${region.label}</b><span>${region.value.toLocaleString('es-MX')} MW · valor ilustrativo</span>`;
      showPopup(path, point);
    };
    mapElement.addEventListener('pointerover', (event) => { if (event.target.matches('path')) showPopup(event.target, event); });
    mapElement.addEventListener('focusin', (event) => { if (event.target.matches('path')) showPopup(event.target); });
    mapElement.addEventListener('click', (event) => { if (event.target.matches('path')) select(event.target, event); });
    mapElement.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('path')) { event.preventDefault(); select(event.target); } if (event.key === 'Escape') popup.hidden = true; });
    popup.querySelector('button').addEventListener('click', () => { popup.hidden = true; });
  }
})();
