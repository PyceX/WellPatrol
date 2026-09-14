/**
 * app.js — WellPatrol
 * Голосовой ввод показаний (Web Speech API), картография Leaflet для указания меток на карте,
 * динамическая сортировка (По номеру / По GPS), правила округления Q, фильтры обхода и контролеры отклонений.
 */
'use strict';

/* ── Состояние ───────────────────────────────────────────── */
const App = {
  ptv: localStorage.getItem('dng_active_ptv') || '11',
  gps: null,
  wells: [],
  ruler: 0,
  prevMeter: null,
  prevMeas: null,
  patrolFilter: 'all',
  pzFilter: 'all',
  sortMode: localStorage.getItem('dng_sort_mode') || 'num',
  theme: localStorage.getItem('dng_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
};

/* ── ТЕМА (День / Ночь) ─────────────────────────────────── */
function applyTheme(theme) {
  App.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dng_theme', theme);

  const iconEl = document.getElementById('theme-icon');
  const textEl = document.getElementById('theme-text');
  const btnEl = document.getElementById('btn-theme-toggle');
  const metaTheme = document.getElementById('meta-theme-color') || document.querySelector('meta[name="theme-color"]');
  const appleStatusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');

  const themeColor = '#161b22';
  if (metaTheme) metaTheme.setAttribute('content', themeColor);
  if (appleStatusMeta) appleStatusMeta.setAttribute('content', 'black-translucent');

  if (theme === 'light') {
    if (iconEl) iconEl.textContent = '☀️';
    if (textEl) textEl.textContent = 'День';
    if (btnEl) btnEl.title = 'Переключить на ночную тему';
  } else {
    if (iconEl) iconEl.textContent = '🌙';
    if (textEl) textEl.textContent = 'Ночь';
    if (btnEl) btnEl.title = 'Переключить на дневную тему';
  }
}

function initTheme() {
  applyTheme(App.theme);
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const nextTheme = App.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      toast(nextTheme === 'light' ? '☀️ Включен дневной режим' : '🌙 Включен ночной режим', 'success');
    });
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!localStorage.getItem('dng_theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}

/* ── Утилиты ─────────────────────────────────────────────── */
const today = () => new Date().toISOString().split('T')[0];
const now = () => new Date().toTimeString().substring(0, 5);
const fmt = v => (v != null && v !== '') ? v : '—';

function formatMeter(val) {
  if (val == null || val === '' || isNaN(val)) return '—';
  const parts = val.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join('.');
}

/**
 * Округление Q факт по правилам:
 * >= 1000 л (или >= 1.0 m³): 1500 л -> 2 м³, 1499 л -> 1 м³ (до целых)
 * < 1000 л (или < 1.0 m³): 950 л -> 1 м³, 949 л -> 0.9 м³ (до 0.1)
 */
function formatQ(diff) {
  if (diff == null || isNaN(diff) || diff < 0) return '';
  const v = diff >= 10 ? diff / 1000 : diff;
  if (diff >= 1000 || v >= 1.0) {
    return Math.round(v).toString();
  } else {
    const rounded = Math.round(v * 10) / 10;
    return rounded === 1 ? '1' : rounded.toFixed(1);
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const r = d => d * Math.PI / 180;
  const p1 = r(lat1), p2 = r(lat2);
  const dp = r(lat2 - lat1), dl = r(lon2 - lon1);
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function download(content, name, type) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type })),
    download: name,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/* ── Toast ───────────────────────────────────────────────── */
let toastTmr;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  clearTimeout(toastTmr);
  el.textContent = msg;
  el.className = `toast${type ? ' ' + type : ''}`;
  void el.offsetWidth;
  el.classList.add('show');
  toastTmr = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 250);
  }, 2500);
}

/* ── Инициализация ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initPtv();
  initNav();
  initGps();
  initSort();
  initPatrolFilters();
  initMeasureForm();
  initExport();
  initExportModal();
  initPz();
  initSearch();
  initAddWell();
  initScanOcr();

  document.getElementById('report-date').value = today();
  document.getElementById('export-date').value = today();
  await refresh();
});

/* ── ПТВ ─────────────────────────────────────────────────── */
function initPtv() {
  const sel = document.getElementById('ptv-select');
  sel.value = App.ptv;
  sel.addEventListener('change', async e => {
    App.ptv = e.target.value;
    localStorage.setItem('dng_active_ptv', App.ptv);
    App.ruler = 0;
    await refresh();
  });
}

/* ── Навигация ───────────────────────────────────────────── */
function initNav() {
  const btns = document.querySelectorAll('.nav-btn');
  const tabs = document.querySelectorAll('.tab-pane');

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      btns.forEach(b => b.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(id)?.classList.add('active');
      if (id === 'tab-report') renderReport();
      else if (id === 'tab-patrol') renderPatrol();
      else if (id === 'tab-pz') renderPz();
    });
  });
}

/* ── GPS ─────────────────────────────────────────────────── */
function initGps() {
  const badge = document.getElementById('gps-status');
  if (!('geolocation' in navigator)) {
    badge.textContent = 'GPS: нет';
    return;
  }
  navigator.geolocation.watchPosition(
    ({ coords }) => {
      App.gps = { lat: coords.latitude, lon: coords.longitude };
      badge.textContent = `GPS: ±${Math.round(coords.accuracy)}м`;
      badge.classList.add('active');
      renderPatrol();
    },
    () => {
      badge.textContent = 'GPS: нет';
      badge.classList.remove('active');
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 }
  );
}

/* ── Сортировка ─────────────────────────────────────────── */
function initSort() {
  const sel = document.getElementById('patrol-sort-select');
  if (!sel) return;
  sel.value = App.sortMode;
  sel.addEventListener('change', async e => {
    App.sortMode = e.target.value;
    localStorage.setItem('dng_sort_mode', App.sortMode);
    await renderPatrol();
    await renderReport();
  });
}

/* ── Обновить всё ────────────────────────────────────────── */
async function refresh() {
  App.wells = await getWellsByPtv(App.ptv);
  await renderPatrol();
  await renderReport();
  await renderPz();
}

/* ── Поиск и Фильтры Обхода ──────────────────────────────── */
function initSearch() {
  document.getElementById('well-search').addEventListener('input', debounce(renderPatrol, 200));
}

function initPatrolFilters() {
  const container = document.getElementById('patrol-filter-pills');
  if (!container) return;
  container.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      App.patrolFilter = btn.dataset.filter;
      renderPatrol();
    });
  });
}

/* ── Таб 1: Обход ────────────────────────────────────────── */
async function renderPatrol() {
  const box = document.getElementById('wells-list');
  const q = document.getElementById('well-search').value.trim().toLowerCase();
  const d = today();

  let list = App.wells.map(w => ({
    ...w,
    dist: (App.gps && w.lat && w.lon)
      ? haversine(App.gps.lat, App.gps.lon, w.lat, w.lon)
      : null,
  }));

  const meas = await getMeasurementsByDay(d);
  const prevMap = await getPreviousMeasurementsMap(d);
  const mapMeas = new Map(meas.map(m => [m.well_id, m]));
  const done = new Set(meas.map(m => m.well_id));

  // Фильтр по типу (Все, Осталось, Завершено, С примечаниями)
  if (App.patrolFilter === 'todo') {
    list = list.filter(w => !done.has(w.id));
  } else if (App.patrolFilter === 'done') {
    list = list.filter(w => done.has(w.id));
  } else if (App.patrolFilter === 'notes') {
    const notesWells = new Set(meas.filter(m => m.notes && m.notes.trim()).map(m => m.well_id));
    list = list.filter(w => notesWells.has(w.id));
  }

  // Фильтр по поисковому запросу
  if (q) list = list.filter(w => w.well_number.toLowerCase().includes(q));

  // Сортировка: По Номеру (по умолчанию) / По GPS
  if (App.sortMode === 'gps') {
    list.sort((a, b) => (a.dist ?? 9e9) - (b.dist ?? 9e9));
  } else {
    list.sort((a, b) => a.well_number.localeCompare(b.well_number, undefined, { numeric: true }));
  }

  document.getElementById('patrol-progress').textContent = `${done.size} / ${App.wells.length} измерено`;

  if (!list.length) {
    box.innerHTML = `<div class="empty-state"><p>${q ? 'Скважина не найдена' : 'Нет скважин в этом списке'}</p></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach(w => {
    const m = mapMeas.get(w.id);
    const prevM = prevMap.get(w.id);
    const ok = Boolean(m);
    const el = document.createElement('div');
    el.className = `well-card${ok ? ' done' : ''}`;

    const dist = w.dist != null ? `<span class="distance-tag">${w.dist}м</span>` : '';
    
    let measInfo = '';
    if (ok && m.flow_rate_q != null) {
      const timeStr = m.time ? ` · ⏰ ${m.time}` : '';
      const prevQ = prevM?.flow_rate_q != null ? Number(prevM.flow_rate_q) : null;
      const currentQ = Number(m.flow_rate_q);
      const isDrop = (prevQ != null && (prevQ - currentQ) >= 3);

      if (isDrop) {
        measInfo = ` · <span class="card-q-tag card-q-drop" data-prev-q="${prevQ}" title="Нажмите, чтобы увидеть последний">Q: ${m.flow_rate_q} м³</span>${timeStr}`;
      } else {
        measInfo = ` · <span class="card-q-tag">Q: ${m.flow_rate_q} м³</span>${timeStr}`;
      }
    } else if (ok && m.time) {
      measInfo = ` · ⏰ ${m.time}`;
    }

    el.innerHTML = `
      <div class="well-info">
        <div class="well-title"><span>№ ${w.well_number}</span>${dist}</div>
        <div class="well-subtext">ПТВ-${w.ptv}${measInfo}</div>
      </div>
      <div class="status-check">${ok ? '✓' : '○'}</div>`;

    el.addEventListener('click', () => openMeasure(w));

    const dropTag = el.querySelector('.card-q-drop');
    if (dropTag) {
      dropTag.addEventListener('click', e => {
        e.stopPropagation();
        const pq = dropTag.dataset.prevQ;
        toast(`Последний: ${pq} м³`, 'info');
      });
    }

    frag.appendChild(el);
  });

  box.innerHTML = '';
  box.appendChild(frag);
}

/* ── Таб 2: Рапорт ──────────────────────────────────────── */
async function renderReport() {
  const tbody = document.getElementById('report-table-body');
  const date = document.getElementById('report-date').value;
  const meas = await getMeasurementsByDay(date);
  const prevMap = await getPreviousMeasurementsMap(date);
  const map = new Map(meas.map(m => [m.well_id, m]));

  let sortedWells = [...App.wells].sort((a, b) => 
    a.well_number.localeCompare(b.well_number, undefined, { numeric: true })
  );

  const frag = document.createDocumentFragment();
  sortedWells.forEach((w, i) => {
    const m = map.get(w.id) || {};
    const prevM = prevMap.get(w.id);
    const prevQ = prevM?.flow_rate_q != null ? Number(prevM.flow_rate_q) : null;
    const currentQ = m.flow_rate_q != null ? Number(m.flow_rate_q) : null;
    const isDrop = (prevQ != null && currentQ != null && (prevQ - currentQ) >= 3);

    let qDisplay = fmt(m.flow_rate_q);
    if (isDrop) {
      qDisplay = `<span class="q-drop-text" data-prev-q="${prevQ}" title="Нажмите, чтобы увидеть последний">${fmt(m.flow_rate_q)}</span>`;
    }

    const tr = document.createElement('tr');
    tr.dataset.index = i;
    tr.innerHTML = `
      <td><b>${w.well_number}</b></td>
      <td>${formatMeter(m.meter_reading)}</td>
      <td><b>${qDisplay}</b></td>
      <td>${fmt(m.p_buf)}</td>
      <td>${fmt(m.p_zat)}</td>
      <td>${fmt(m.temperature)}</td>
      <td>${fmt(m.strokes_per_minute)}</td>
      <td>${m.time || '—'}</td>
      <td class="td-notes">${m.notes || ''}</td>`;
    
    tr.addEventListener('click', () => setRuler(i));

    const dropEl = tr.querySelector('.q-drop-text');
    if (dropEl) {
      dropEl.addEventListener('click', e => {
        e.stopPropagation();
        const pq = dropEl.dataset.prevQ;
        toast(`Последний: ${pq} м³`, 'info');
      });
    }

    frag.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(frag);
  highlightRuler();
}

document.getElementById('report-date')?.addEventListener('change', renderReport);

/* ── Подсветка строки в рапорте ──────────────────────────── */
function setRuler(i) { App.ruler = i; highlightRuler(); }

function highlightRuler() {
  document.querySelectorAll('#report-table-body tr').forEach((r, i) => {
    const active = i === App.ruler;
    r.classList.toggle('ruler-active', active);
    if (active) r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

/* ── Контроль отклонений ─────────────────────────────────── */
function checkAnomalies() {
  const prev = App.prevMeas;

  // P буф
  const pbufInput = document.getElementById('input-pbuf');
  const warnPbuf = document.getElementById('warn-pbuf');
  const pbufVal = parseFloat(pbufInput.value);
  if (!isNaN(pbufVal) && prev && prev.p_buf != null) {
    const diffRatio = Math.abs(pbufVal - prev.p_buf) / (prev.p_buf || 1);
    if (diffRatio > 0.25) {
      warnPbuf.textContent = `⚠️ Отклонение от последний (${prev.p_buf} атм)`;
      warnPbuf.classList.remove('hidden');
      pbufInput.classList.add('input-warning');
    } else {
      warnPbuf.classList.add('hidden');
      pbufInput.classList.remove('input-warning');
    }
  } else {
    warnPbuf.classList.add('hidden');
    pbufInput.classList.remove('input-warning');
  }

  // P зат
  const pzatInput = document.getElementById('input-pzat');
  const warnPzat = document.getElementById('warn-pzat');
  const pzatVal = parseFloat(pzatInput.value);
  if (!isNaN(pzatVal) && prev && prev.p_zat != null) {
    const diffRatio = Math.abs(pzatVal - prev.p_zat) / (prev.p_zat || 1);
    if (diffRatio > 0.25) {
      warnPzat.textContent = `⚠️ Отклонение от последний (${prev.p_zat} атм)`;
      warnPzat.classList.remove('hidden');
      pzatInput.classList.add('input-warning');
    } else {
      warnPzat.classList.add('hidden');
      pzatInput.classList.remove('input-warning');
    }
  } else {
    warnPzat.classList.add('hidden');
    pzatInput.classList.remove('input-warning');
  }

  // Q факт
  const flowInput = document.getElementById('input-flow');
  const warnFlow = document.getElementById('warn-flow');
  const flowVal = parseFloat(flowInput.value);
  if (!isNaN(flowVal) && flowVal < 0) {
    warnFlow.textContent = `⚠️ Отрицательный дебит!`;
    warnFlow.classList.remove('hidden');
    flowInput.classList.add('input-warning');
  } else {
    warnFlow.classList.add('hidden');
    flowInput.classList.remove('input-warning');
  }
}

/* ── Рендер Истории и Графика в Модале ────────────────────── */
function renderHistoryChart(list) {
  const box = document.getElementById('history-chart');
  const tbody = document.getElementById('history-table-body');

  if (!list || !list.length) {
    box.innerHTML = '<div style="padding:40px;text-align:center;font-size:0.75rem;color:var(--c-text-muted)">Нет предыдущих замеров</div>';
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">История пуста</td></tr>';
    return;
  }

  // Таблица
  tbody.innerHTML = list.map(m => `
    <tr>
      <td><b>${m.date ? m.date.slice(5) : '—'}</b></td>
      <td>${formatMeter(m.meter_reading)}</td>
      <td><b>${m.flow_rate_q ?? '—'}</b></td>
      <td>${m.p_buf ?? '—'}</td>
      <td>${m.p_zat ?? '—'}</td>
    </tr>
  `).join('');

  // SVG График
  const validQ = list.filter(m => m.flow_rate_q != null && !isNaN(m.flow_rate_q)).reverse();
  if (validQ.length < 2) {
    box.innerHTML = '<div style="padding:40px;text-align:center;font-size:0.75rem;color:var(--c-text-muted)">Мало данных для построения графика</div>';
    return;
  }

  const qVals = validQ.map(m => Number(m.flow_rate_q));
  const maxQ = Math.max(...qVals, 1);
  const minQ = Math.min(...qVals, 0);
  const range = (maxQ - minQ) || 1;

  const w = 320, h = 100, pad = 20;
  const points = validQ.map((m, idx) => {
    const x = pad + (idx / (validQ.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((Number(m.flow_rate_q) - minQ) / range) * (h - 2 * pad);
    return { x, y, val: m.flow_rate_q, date: m.date ? m.date.slice(5) : '' };
  });

  const polyline = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = points.map(p => `
    <rect x="${(p.x - 3).toFixed(1)}" y="${(p.y - 3).toFixed(1)}" width="6" height="6" fill="var(--c-success)" stroke="var(--c-pixel-border)" stroke-width="1"/>
    <text x="${p.x.toFixed(1)}" y="${(p.y - 7).toFixed(1)}" font-size="9" font-family="'JetBrains Mono', monospace" font-weight="700" text-anchor="middle" fill="var(--c-primary)">${p.val}</text>
  `).join('');

  box.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:100%">
      <polyline fill="none" stroke="var(--c-primary)" stroke-width="2.5" stroke-linecap="square" points="${polyline}"/>
      ${dots}
    </svg>
  `;
}

/* ── Модал: Замер ────────────────────────────────────────── */
async function openMeasure(well) {
  const modal = document.getElementById('modal-measure');
  const d = today();

  document.getElementById('modal-well-title').textContent = `№ ${well.well_number}`;
  document.getElementById('modal-ptv-title').textContent = `ПТВ-${well.ptv}`;
  document.getElementById('form-well-id').value = well.id;
  document.getElementById('input-date').value = d;
  document.getElementById('input-time').value = now();

  // Получить последние данные скважины
  const prevMeas = await getLatestMeasurementBefore(well.id, d);
  App.prevMeas = prevMeas;
  App.prevMeter = prevMeas?.meter_reading ?? null;

  const prevQ = prevMeas?.flow_rate_q ?? null;
  const prevTimeStr = prevMeas?.time ? ` (${prevMeas.time})` : '';
  document.getElementById('prev-meter-text').textContent =
    prevQ != null ? `Последний: ${prevQ} м³${prevTimeStr}` : 'Последний: нет';

  // Установить последние данные как подсказки (placeholder) для полей, кроме примечания
  document.getElementById('input-meter').placeholder   = prevMeas?.meter_reading != null ? prevMeas.meter_reading : '0';
  document.getElementById('input-flow').placeholder    = prevMeas?.flow_rate_q != null ? prevMeas.flow_rate_q : '0.0';
  document.getElementById('input-pbuf').placeholder    = prevMeas?.p_buf != null ? prevMeas.p_buf : '0.0';
  document.getElementById('input-pzat').placeholder    = prevMeas?.p_zat != null ? prevMeas.p_zat : '0.0';
  document.getElementById('input-temp').placeholder    = prevMeas?.temperature != null ? prevMeas.temperature : '0';
  document.getElementById('input-strokes').placeholder = prevMeas?.strokes_per_minute != null ? prevMeas.strokes_per_minute : '0';

  const ex = await getMeasurementByDate(well.id, d);
  const fields = {
    'input-time':    ex?.time ?? now(),
    'input-meter':   ex?.meter_reading ?? '',
    'input-flow':    ex?.flow_rate_q ?? '',
    'input-pbuf':    ex?.p_buf ?? (prevMeas?.p_buf ?? ''),
    'input-pzat':    ex?.p_zat ?? (prevMeas?.p_zat ?? ''),
    'input-temp':    ex?.temperature ?? (prevMeas?.temperature ?? ''),
    'input-strokes': ex?.strokes_per_minute ?? (prevMeas?.strokes_per_minute ?? ''),
    'input-notes':   ex?.notes ?? '',
  };
  Object.entries(fields).forEach(([id, v]) => document.getElementById(id).value = v);

  // Сброс переключателя П/З
  const pzToggle = document.getElementById('input-pz-clone');
  if (pzToggle) pzToggle.checked = false;

  // Сброс предупреждений
  checkAnomalies();

  // Загрузить историю замеров и построить график
  const historyList = await getMeasurementsForWell(well.id, 7);
  renderHistoryChart(historyList);

  modal.classList.remove('hidden');
  requestAnimationFrame(() => document.getElementById('input-meter').focus());
}

function initMeasureForm() {
  const modal = document.getElementById('modal-measure');
  const close = () => modal.classList.add('hidden');

  document.getElementById('btn-close-modal').addEventListener('click', close);
  document.getElementById('btn-cancel-modal').addEventListener('click', close);
  document.getElementById('modal-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  // Переключение аккордеона истории
  document.getElementById('btn-toggle-history').addEventListener('click', () => {
    const content = document.getElementById('history-content');
    const arrow = document.getElementById('history-arrow');
    const isHidden = content.classList.toggle('hidden');
    arrow.textContent = isHidden ? '▼' : '▲';
  });

  const meter = document.getElementById('input-meter');
  const flow = document.getElementById('input-flow');
  const pbuf = document.getElementById('input-pbuf');
  const pzat = document.getElementById('input-pzat');

  // Расчет Q с новыми правилами округления
  meter.addEventListener('input', () => {
    const v = parseFloat(meter.value);
    if (!isNaN(v) && App.prevMeter != null) {
      const diff = v - App.prevMeter;
      if (diff >= 0) {
        flow.value = formatQ(diff);
        document.getElementById('flow-autocalc-badge')?.classList.remove('hidden');
      }
    }
    checkAnomalies();
  });

  flow.addEventListener('input', () => {
    document.getElementById('flow-autocalc-badge')?.classList.add('hidden');
    checkAnomalies();
  });
  pbuf.addEventListener('input', checkAnomalies);
  pzat.addEventListener('input', checkAnomalies);

  document.getElementById('form-measure').addEventListener('submit', async e => {
    e.preventDefault();
    const num = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };

    const wellId = document.getElementById('form-well-id').value;
    const mDate = document.getElementById('input-date').value;
    const mTime = document.getElementById('input-time').value;
    const mMeter = num('input-meter');
    const mNotes = document.getElementById('input-notes').value.trim();

    await saveMeasurement({
      well_id: wellId,
      date: mDate,
      time: mTime,
      meter_reading: mMeter,
      flow_rate_q: num('input-flow'),
      p_buf: num('input-pbuf'),
      p_zat: num('input-pzat'),
      temperature: num('input-temp'),
      strokes_per_minute: num('input-strokes'),
      notes: mNotes,
      timestamp: Date.now(),
    });

    const isPzChecked = document.getElementById('input-pz-clone')?.checked;
    if (isPzChecked) {
      const wellObj = App.wells.find(w => w.id === wellId);
      const wellNum = wellObj ? wellObj.well_number : wellId.replace(/^[0-9]+-/, '');

      await savePzRecord({
        well_number: wellNum,
        well_id: wellId,
        ptv: App.ptv,
        val_1: mMeter,
        time_1: (mDate && mTime) ? `${mDate}T${mTime}` : '',
        val_2: null,
        time_2: null,
        notes: mNotes,
        timestamp: Date.now(),
      });
      toast('✓ Сохранено и скопировано в П/З', 'success');
    } else {
      toast('✓ Сохранено', 'success');
    }

    close();
    await refresh();
  });
}

/* ── Модал: Добавить скважину (Карта Leaflet) ─────────────── */
let pickerMap = null;
let pickerMarker = null;
let selectedCoords = { lat: 45.3150, lon: 51.7850 };

function updatePickerCoords(lat, lon) {
  selectedCoords = { lat: parseFloat(lat.toFixed(4)), lon: parseFloat(lon.toFixed(4)) };
  const latEl = document.getElementById('add-well-lat');
  const lonEl = document.getElementById('add-well-lon');
  if (latEl) latEl.textContent = selectedCoords.lat.toFixed(4);
  if (lonEl) lonEl.textContent = selectedCoords.lon.toFixed(4);
}

function initPickerMap() {
  if (typeof L === 'undefined') return;
  const container = document.getElementById('add-well-map');
  if (!container || pickerMap) return;

  pickerMap = L.map(container, { zoomControl: true }).setView([selectedCoords.lat, selectedCoords.lon], 14);

  L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    attribution: 'Google Спутник'
  }).addTo(pickerMap);

  pickerMarker = L.marker([selectedCoords.lat, selectedCoords.lon], { draggable: true }).addTo(pickerMap);

  pickerMarker.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    updatePickerCoords(pos.lat, pos.lng);
  });

  pickerMap.on('click', (e) => {
    pickerMarker.setLatLng(e.latlng);
    updatePickerCoords(e.latlng.lat, e.latlng.lng);
  });
}

function initAddWell() {
  const modal = document.getElementById('modal-add-well');
  const form = document.getElementById('form-add-well');
  const codeArea = document.getElementById('code-output-area');
  const codeText = document.getElementById('code-output-text');

  const close = () => {
    modal.classList.add('hidden');
    codeArea.classList.add('hidden');
    form.reset();
  };

  // Открытие модала
  document.getElementById('btn-add-well').addEventListener('click', async () => {
    codeArea.classList.add('hidden');
    document.getElementById('add-well-ptv-label').textContent = `ПТВ-${App.ptv}`;

    const startLat = App.gps?.lat ?? 45.3150;
    const startLon = App.gps?.lon ?? 51.7850;
    updatePickerCoords(startLat, startLon);

    document.getElementById('add-well-number').value = '';
    modal.classList.remove('hidden');

    setTimeout(() => {
      if (!pickerMap) initPickerMap();
      if (pickerMap) {
        pickerMap.invalidateSize();
        pickerMap.setView([selectedCoords.lat, selectedCoords.lon], 14);
        if (pickerMarker) pickerMarker.setLatLng([selectedCoords.lat, selectedCoords.lon]);
      }
      document.getElementById('add-well-number').focus();
    }, 150);
  });

  // Кнопка: Привязать к моему GPS
  document.getElementById('btn-snap-gps')?.addEventListener('click', () => {
    if (App.gps) {
      updatePickerCoords(App.gps.lat, App.gps.lon);
      if (pickerMap && pickerMarker) {
        pickerMap.setView([selectedCoords.lat, selectedCoords.lon], 16);
        pickerMarker.setLatLng([selectedCoords.lat, selectedCoords.lon]);
      }
      toast('📍 Метка привязана к вашему GPS', 'success');
    } else {
      toast('GPS не определен', 'error');
    }
  });

  // Закрытие
  document.getElementById('btn-close-add-well').addEventListener('click', close);
  document.getElementById('btn-cancel-add-well').addEventListener('click', close);
  document.getElementById('add-well-backdrop').addEventListener('click', close);

  // Отправка формы
  form.addEventListener('submit', async e => {
    e.preventDefault();

    const wellNum = document.getElementById('add-well-number').value.trim();
    if (!wellNum) {
      toast('Введите номер скважины', 'error');
      return;
    }

    const ptv = Number(App.ptv);
    const lat = selectedCoords.lat;
    const lon = selectedCoords.lon;
    const id = `${ptv}-${wellNum}`;

    // Проверить дубликат
    const existing = App.wells.find(w => w.well_number === wellNum && w.ptv === ptv);
    if (existing) {
      toast('⚠ Такая скважина уже есть в ПТВ', 'error');
      return;
    }

    const wellData = {
      id,
      ptv,
      well_number: wellNum,
      lat: lat ? parseFloat(lat.toFixed(4)) : null,
      lon: lon ? parseFloat(lon.toFixed(4)) : null,
    };

    // Сохранить в IndexedDB
    await addWell(wellData);
    toast('✓ Скважина добавлена с координатами', 'success');
    await refresh();

    // Сгенерировать код для db.js
    const latStr = wellData.lat != null ? wellData.lat.toFixed(4) : 'null';
    const lonStr = wellData.lon != null ? wellData.lon.toFixed(4) : 'null';

    const code = `{ id: '${id}', ptv: ${ptv}, well_number: '${wellNum}', lat: ${latStr}, lon: ${lonStr} },`;

    codeText.textContent = code;
    codeArea.classList.remove('hidden');
  });

  // Копировать код
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = codeText.textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => toast('✓ Скопировано', 'success'));
    } else {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('✓ Скопировано', 'success');
    }
  });
}

/* ── Экспорт / Бэкап ────────────────────────────────────── */
function initExport() {
  document.getElementById('btn-export-csv').addEventListener('click', async () => {
    const date = document.getElementById('export-date').value;
    if (!date) { toast('Выберите дату', 'error'); return; }

    const meas = await getMeasurementsByDay(date);
    const map = new Map(meas.map(m => [m.well_id, m]));
    let wells = await getWellsByPtv(App.ptv);

    if (App.sortMode === 'gps' && App.gps) {
      wells = wells.map(w => ({
        ...w,
        dist: (w.lat && w.lon) ? haversine(App.gps.lat, App.gps.lon, w.lat, w.lon) : 9e9
      })).sort((a, b) => (a.dist ?? 9e9) - (b.dist ?? 9e9));
    } else {
      wells.sort((a, b) => a.well_number.localeCompare(b.well_number, undefined, { numeric: true }));
    }

    let csv = '\uFEFFСкважина;ПТВ;Показания;Q факт;P буф;P зат;t°C;Об/Чк;Время;Дата;Примечание\n';
    wells.forEach(w => {
      const m = map.get(w.id) || {};
      csv += [
        w.well_number, w.ptv,
        m.meter_reading ?? '', m.flow_rate_q ?? '',
        m.p_buf ?? '', m.p_zat ?? '',
        m.temperature ?? '', m.strokes_per_minute ?? '',
        m.time ?? '', date,
        `"${(m.notes || '').replace(/"/g, '""')}"`,
      ].join(';') + '\n';
    });

    download(csv, `Рапорт_ПТВ${App.ptv}_${date}.csv`, 'text/csv;charset=utf-8;');
    toast('📥 CSV загружен', 'success');
  });

  const btnExportBackup = document.getElementById('btn-export-backup');
  if (btnExportBackup) {
    btnExportBackup.addEventListener('click', async () => {
      try {
        const dump = await exportFullDB();
        const jsonStr = JSON.stringify(dump, null, 2);
        const d = today();
        download(jsonStr, `WellPatrol_Backup_${d}.json`, 'application/json;charset=utf-8;');
        toast('💾 Бэкап сохранен (.json)', 'success');
      } catch (err) {
        console.error('Backup error:', err);
        toast('Ошибка при создании бэкапа', 'error');
      }
    });
  }

  const importFile = document.getElementById('import-file');
  if (importFile) {
    importFile.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = async ({ target }) => {
        try {
          const parsed = JSON.parse(target.result);
          await restoreDB(parsed);
          toast('Восстановлено ✓', 'success');
          await refresh();
        } catch (err) {
          console.error('Restore error:', err);
          toast('Ошибка: неверный файл', 'error');
        } finally { e.target.value = ''; }
      };
      r.readAsText(file);
    });
  }
}

/* ── Утилиты П/З и Формулы ────────────────────────────────── */
const getLocalDatetime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

const formatDateTimePz = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const mon = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${hh}:${mm}, ${dd}-${mon}-${yy}`;
};

const formatDuration = (mins) => {
  if (!mins || mins <= 0) return '0 мин';
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  if (hrs > 0 && m > 0) return `${hrs} ч ${m} мин`;
  if (hrs > 0) return `${hrs} ч`;
  return `${m} мин`;
};

/**
 * Расчет дебита (м³/сут) по формуле из Пример/app.js:
 * (1440 / minutes) * (v2 - v1) / 1000
 */
const calculateVolume = (v1, t1, v2, t2) => {
  if (v1 == null || !t1 || v2 == null || !t2) return null;
  const d1 = new Date(t1);
  const d2 = new Date(t2);
  const minutes = (d2 - d1) / 60000;

  if (isNaN(minutes) || minutes <= 0) {
    return { debit: 'Ошибка времени', minutes: 0, diffV: 0, isError: true };
  }

  const diffV = v2 - v1;
  const result = (1440 / minutes) * diffV / 1000;
  return {
    debit: Math.round(result),
    minutes: Math.round(minutes),
    diffV: diffV,
    isError: false,
  };
};

function initExportModal() {
  const modal = document.getElementById('modal-export');
  const openBtn = document.getElementById('btn-open-export');
  const closeBtn = document.getElementById('btn-close-export');
  const backdrop = document.getElementById('export-backdrop');

  if (!modal) return;
  const close = () => modal.classList.add('hidden');

  openBtn?.addEventListener('click', () => modal.classList.remove('hidden'));
  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);
}

/* ── Таб 3: П/З (Перезамер) ────────────────────────────── */
function initPz() {
  const searchInput = document.getElementById('pz-search');
  if (searchInput) searchInput.addEventListener('input', debounce(renderPz, 200));

  const filterContainer = document.getElementById('pz-filter-pills');
  if (filterContainer) {
    filterContainer.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterContainer.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        App.pzFilter = btn.dataset.pzFilter;
        renderPz();
      });
    });
  }

  // Кнопка "+ П/З" (Ручное добавление)
  document.getElementById('btn-add-pz-manual')?.addEventListener('click', () => {
    openPzEditModal();
  });

  // Модал редактирования П/З
  const pzModal = document.getElementById('modal-pz-edit');
  const closePzEdit = () => pzModal.classList.add('hidden');

  document.getElementById('btn-close-pz-edit')?.addEventListener('click', closePzEdit);
  document.getElementById('btn-cancel-pz-edit')?.addEventListener('click', closePzEdit);
  document.getElementById('pz-edit-backdrop')?.addEventListener('click', closePzEdit);

  document.getElementById('form-pz-edit')?.addEventListener('submit', async e => {
    e.preventDefault();
    const idVal = document.getElementById('pz-edit-id').value;
    const wellNum = document.getElementById('pz-edit-well-number').value.trim();
    const v1 = parseFloat(document.getElementById('pz-edit-v1').value);
    const t1 = document.getElementById('pz-edit-t1').value;
    const v2Raw = document.getElementById('pz-edit-v2').value;
    const v2 = v2Raw !== '' ? parseFloat(v2Raw) : null;
    const t2 = document.getElementById('pz-edit-t2').value || null;
    const notesInput = document.getElementById('pz-edit-notes');
    const notes = notesInput ? notesInput.value.trim() : '';

    if (!wellNum || isNaN(v1)) {
      toast('Заполните номер скважины и Замер 1', 'error');
      return;
    }

    const record = {
      well_number: wellNum,
      ptv: App.ptv,
      val_1: v1,
      time_1: t1,
      val_2: isNaN(v2) ? null : v2,
      time_2: t2,
      notes,
      timestamp: Date.now(),
    };
    if (idVal) record.id = Number(idVal);

    await savePzRecord(record);
    closePzEdit();
    toast('✓ Перезамер сохранен', 'success');
    await renderPz();
  });

  // Модал клонирования П/З
  const cloneModal = document.getElementById('modal-pz-clone');
  const closePzClone = () => cloneModal.classList.add('hidden');

  document.getElementById('btn-close-pz-clone')?.addEventListener('click', closePzClone);
  document.getElementById('btn-cancel-pz-clone')?.addEventListener('click', closePzClone);
  document.getElementById('pz-clone-backdrop')?.addEventListener('click', closePzClone);

  document.getElementById('form-pz-clone')?.addEventListener('submit', async e => {
    e.preventDefault();
    const sourceId = Number(document.getElementById('pz-clone-source-id').value);
    const newWellNum = document.getElementById('pz-clone-well-number').value.trim();
    const sourceOpt = document.querySelector('input[name="pz-clone-source"]:checked')?.value || '1';

    if (!newWellNum) {
      toast('Введите номер новой скважины', 'error');
      return;
    }

    const records = await getAllPzRecords();
    const sourceRecord = records.find(r => r.id === sourceId);
    if (!sourceRecord) {
      toast('Исходная запись не найдена', 'error');
      return;
    }

    const startVal = sourceOpt === '2' ? sourceRecord.val_2 : sourceRecord.val_1;
    const startTime = sourceOpt === '2' ? sourceRecord.time_2 : sourceRecord.time_1;

    const newRecord = {
      well_number: newWellNum,
      ptv: sourceRecord.ptv || App.ptv,
      val_1: startVal,
      time_1: startTime || getLocalDatetime(),
      val_2: null,
      time_2: null,
      notes: `Клон с №${sourceRecord.well_number}`,
      timestamp: Date.now(),
    };

    await savePzRecord(newRecord);
    closePzClone();
    toast('✓ Клонировано в П/З', 'success');
    await renderPz();
  });

  // Автоматическое обновление времени на инпутах с классом auto-time каждые 10 сек
  setInterval(() => {
    const curDt = getLocalDatetime();
    document.querySelectorAll('.auto-time').forEach(el => {
      el.value = curDt;
    });
  }, 10000);
}

function openPzEditModal(record = null) {
  const modal = document.getElementById('modal-pz-edit');
  document.getElementById('pz-edit-id').value = record ? record.id : '';
  document.getElementById('pz-edit-well-number').value = record ? record.well_number : '';
  document.getElementById('pz-edit-v1').value = record && record.val_1 != null ? record.val_1 : '';
  document.getElementById('pz-edit-t1').value = record && record.time_1 ? record.time_1 : getLocalDatetime();
  document.getElementById('pz-edit-v2').value = record && record.val_2 != null ? record.val_2 : '';
  document.getElementById('pz-edit-t2').value = record && record.time_2 ? record.time_2 : '';
  const notesInput = document.getElementById('pz-edit-notes');
  if (notesInput) notesInput.value = record && record.notes ? record.notes : '';

  document.getElementById('pz-modal-title').textContent = record ? `Скв. № ${record.well_number}` : 'Новый перезамер';
  modal.classList.remove('hidden');
}

function openPzCloneModal(record) {
  const modal = document.getElementById('modal-pz-clone');
  document.getElementById('pz-clone-source-id').value = record.id;
  document.getElementById('pz-clone-well-name').textContent = record.well_number;
  document.getElementById('pz-clone-well-number').value = record.well_number;
  document.getElementById('pz-clone-v1-text').textContent = formatMeter(record.val_1);
  document.getElementById('pz-clone-t1-text').textContent = formatDateTimePz(record.time_1);

  const opt2Wrap = document.getElementById('pz-clone-opt-2-wrap');
  if (record.val_2 != null) {
    opt2Wrap.style.display = 'flex';
    document.getElementById('pz-clone-v2-text').textContent = formatMeter(record.val_2);
    document.getElementById('pz-clone-t2-text').textContent = formatDateTimePz(record.time_2);
  } else {
    opt2Wrap.style.display = 'none';
    const radio1 = document.querySelector('input[name="pz-clone-source"][value="1"]');
    if (radio1) radio1.checked = true;
  }

  modal.classList.remove('hidden');
}

window.saveInlineSecond = async (id) => {
  const v2Input = document.getElementById(`v2-${id}`);
  const t2Input = document.getElementById(`t2-${id}`);
  if (!v2Input || !t2Input) return;

  const v2 = parseFloat(v2Input.value);
  const t2 = t2Input.value;

  if (isNaN(v2) || !t2) {
    toast('Укажите показание 2 и время', 'error');
    return;
  }

  const records = await getAllPzRecords();
  const record = records.find(r => r.id === Number(id));
  if (!record) return;

  record.val_2 = v2;
  record.time_2 = t2;

  await savePzRecord(record);
  toast('⚡ Дебит рассчитан', 'success');
  await renderPz();
};

window.copyPzReport = async (id, btnEl) => {
  const records = await getAllPzRecords();
  const r = records.find(w => w.id === Number(id));
  if (!r || r.val_2 == null) return;

  const res = calculateVolume(r.val_1, r.time_1, r.val_2, r.time_2);
  if (!res || res.isError) return;

  const durStr = formatDuration(res.minutes);
  const textToCopy = `Скв. ${r.well_number}\n${r.val_1} (${formatDateTimePz(r.time_1)}) - ${r.val_2} (${formatDateTimePz(r.time_2)}) = ${res.debit} м³/сут (${durStr})`;

  try {
    await navigator.clipboard.writeText(textToCopy);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = textToCopy;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  if (btnEl) {
    const origHTML = btnEl.innerHTML;
    btnEl.innerHTML = '<span>✓ Скопировано!</span>';
    setTimeout(() => { btnEl.innerHTML = origHTML; }, 2000);
  } else {
    toast('📋 Отчет скопирован', 'success');
  }
};

async function renderPz() {
  const container = document.getElementById('pz-list');
  if (!container) return;

  const q = document.getElementById('pz-search')?.value.trim().toLowerCase() || '';
  let records = await getAllPzRecords();

  if (App.pzFilter === 'pending') {
    records = records.filter(r => r.val_2 == null);
  } else if (App.pzFilter === 'done') {
    records = records.filter(r => r.val_2 != null);
  }

  if (q) {
    records = records.filter(r => (r.well_number || '').toLowerCase().includes(q));
  }

  if (!records.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔄</div>
        <p>${q ? 'Записи не найдены' : 'Журнал перезамеров пуст'}</p>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  records.forEach(r => {
    const isDone = r.val_2 != null && r.time_2;
    const res = isDone ? calculateVolume(r.val_1, r.time_1, r.val_2, r.time_2) : null;
    const card = document.createElement('div');
    card.className = `pz-card ${isDone ? 'completed' : 'pending'}`;

    if (isDone) {
      card.innerHTML = `
        <div class="pz-card-header">
          <div class="pz-card-title">
            <span class="pz-well-num">Скв. № ${r.well_number}</span>
            ${r.ptv ? `<span class="prev-badge" style="font-size:0.68rem;">ПТВ-${r.ptv}</span>` : ''}
          </div>
          <div class="pz-card-actions">
            <button type="button" class="btn-icon-sq btn-pz-clone" title="Клонировать">📋</button>
            <button type="button" class="btn-icon-sq btn-pz-edit" title="Редактировать">✏️</button>
            <button type="button" class="btn-icon-sq danger btn-pz-del" title="Удалить">🗑️</button>
          </div>
        </div>
        <div class="pz-meas-grid-completed">
          <div class="pz-meas-col">
            <span class="pz-meas-lbl">1-й Замер</span>
            <span class="pz-meas-val">${formatMeter(r.val_1)}</span>
            <span class="pz-meas-time">⏰ ${formatDateTimePz(r.time_1)}</span>
          </div>
          <div class="pz-meas-col">
            <span class="pz-meas-lbl" style="color:var(--c-primary);">2-й Замер</span>
            <span class="pz-meas-val">${formatMeter(r.val_2)}</span>
            <span class="pz-meas-time">⏰ ${formatDateTimePz(r.time_2)}</span>
          </div>
          <div class="pz-debit-banner ${res && res.isError ? 'error' : ''}">
            <div class="pz-debit-main">
              <span class="pz-debit-lbl">${res && res.isError ? 'Ошибка' : 'Дебит'}</span>
              <span class="pz-debit-val">${res ? res.debit : ''} ${res && !res.isError ? '<small>м³/сут</small>' : ''}</span>
              ${res && !res.isError ? `<span class="pz-debit-sub">⏱️ ${formatDuration(res.minutes)}</span>` : ''}
            </div>
            ${res && !res.isError ? `<button type="button" class="pz-copy-btn" onclick="copyPzReport('${r.id}', this)" title="Скопировать отчет">📋 Скопировать</button>` : ''}
          </div>
        </div>
      `;
    } else {
      const defaultT2 = getLocalDatetime();
      card.innerHTML = `
        <div class="pz-card-header">
          <div class="pz-card-title">
            <span class="pz-well-num">Скв. № ${r.well_number}</span>
            ${r.ptv ? `<span class="prev-badge" style="font-size:0.68rem;">ПТВ-${r.ptv}</span>` : ''}
            <span class="pz-status-badge pending">1-й замер</span>
          </div>
          <div class="pz-card-actions">
            <button type="button" class="btn-icon-sq btn-pz-clone" title="Клонировать">📋</button>
            <button type="button" class="btn-icon-sq btn-pz-edit" title="Редактировать">✏️</button>
            <button type="button" class="btn-icon-sq danger btn-pz-del" title="Удалить">🗑️</button>
          </div>
        </div>
        <div class="pz-pending-box">
          <div class="pz-meas-col">
            <span class="pz-meas-lbl">1-й Замер</span>
            <span class="pz-meas-val">${formatMeter(r.val_1)}</span>
            <span class="pz-meas-time">⏰ ${formatDateTimePz(r.time_1)}</span>
          </div>
          <div class="pz-quick-form">
            <span class="pz-quick-lbl">⚡ 2-й замер (быстрый расчет)</span>
            <div class="pz-quick-inputs">
              <input type="number" step="any" id="v2-${r.id}" placeholder="Показ. 2" class="pz-input-field font-mono">
              <input type="datetime-local" id="t2-${r.id}" value="${defaultT2}" class="pz-input-field auto-time" onfocus="this.classList.remove('auto-time')" oninput="this.classList.remove('auto-time')">
            </div>
            <button type="button" onclick="saveInlineSecond('${r.id}')" class="btn-calc-pz">⚡ Рассчитать дебит</button>
          </div>
        </div>
      `;
    }

    card.querySelector('.btn-pz-edit').addEventListener('click', () => openPzEditModal(r));
    card.querySelector('.btn-pz-clone').addEventListener('click', () => openPzCloneModal(r));
    card.querySelector('.btn-pz-del').addEventListener('click', async () => {
      if (confirm(`Удалить перезамер для скважины № ${r.well_number}?`)) {
        await deletePzRecord(r.id);
        toast('Запись удалена', 'success');
        await renderPz();
      }
    });

    frag.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(frag);
}

/* ── Импорт рапорта с фото через ИИ ───────── */
let scanParsedRecords = [];
let scanReportDate = today();

function initScanOcr() {
  const btnOpen = document.getElementById('btn-open-scan');
  const modal = document.getElementById('modal-scan-ocr');
  const btnClose = document.getElementById('btn-close-scan');
  const btnCancel = document.getElementById('btn-cancel-scan');
  const backdrop = document.getElementById('scan-backdrop');
  const keyInput = document.getElementById('input-gemini-key');
  const fileInput = document.getElementById('input-report-photo');
  const btnApply = document.getElementById('btn-apply-scan');
  const checkAll = document.getElementById('scan-check-all');

  if (!btnOpen || !modal) return;

  const close = () => modal.classList.add('hidden');

  btnOpen.addEventListener('click', () => {
    const savedKey = localStorage.getItem('ai_api_key') || localStorage.getItem('gemini_api_key') || '';
    keyInput.value = savedKey;

    document.getElementById('scan-step-1').classList.remove('hidden');
    document.getElementById('scan-loading').classList.add('hidden');
    document.getElementById('scan-step-2').classList.add('hidden');

    fileInput.value = '';
    modal.classList.remove('hidden');
  });

  btnClose.addEventListener('click', close);
  btnCancel.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  keyInput.addEventListener('change', () => {
    const val = keyInput.value.trim();
    if (val) {
      localStorage.setItem('ai_api_key', val);
      localStorage.setItem('gemini_api_key', val);
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const apiKey = keyInput.value.trim() || localStorage.getItem('ai_api_key') || localStorage.getItem('gemini_api_key') || '';
    if (!apiKey) {
      toast('Введите Gemini API Key!', 'error');
      keyInput.focus();
      return;
    }
    localStorage.setItem('ai_api_key', apiKey);
    localStorage.setItem('gemini_api_key', apiKey);

    document.getElementById('scan-step-1').classList.add('hidden');
    document.getElementById('scan-loading').classList.remove('hidden');

    try {
      const base64Data = await fileToBase64(file);
      const mimeType = file.type || 'image/jpeg';

      const promptText = `Ты — эксперт по распознаванию промысловой документации нефтяных месторождений.
Перед тобой фото рукописного суточного рапорта операторов (Каражанбас).
Проанализируй таблицу и извлеки данные по ВСЕМ скважинам строго в формате JSON.

Формат ответа STRICT JSON (без маркдауна, без \`\`\`json):
{
  "date": "YYYY-MM-DD",
  "records": [
    {
      "well_number": "номер скважины, напр. '1170', '1171', '1260G', '1261'",
      "meter_reading": "показание счётчика (строка или число), напр '77619723' или '2 стук'",
      "flow_rate_q": число_Q_нақты_или_null,
      "p_buf": число_P_буф_или_null,
      "p_zat": число_P_зат_или_null,
      "temperature": число_температуры_или_null,
      "strokes_per_minute": число_об_мин_или_null,
      "time": "HH:MM"
    }
  ]
}`;

      const rawText = await callGeminiVisionApi(apiKey, mimeType, base64Data, promptText);

      const cleanJson = rawText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      scanReportDate = parsed.date || today();
      scanParsedRecords = parsed.records || [];

      renderScanPreviewTable(scanParsedRecords, scanReportDate);

      document.getElementById('scan-loading').classList.add('hidden');
      document.getElementById('scan-step-2').classList.remove('hidden');

    } catch (err) {
      console.error('OCR Error:', err);
      toast(`Ошибка OCR: ${err.message}`, 'error');
      document.getElementById('scan-loading').classList.add('hidden');
      document.getElementById('scan-step-1').classList.remove('hidden');
    }
  });

  checkAll.addEventListener('change', () => {
    const isChecked = checkAll.checked;
    document.querySelectorAll('.scan-row-check').forEach(c => c.checked = isChecked);
  });

  btnApply.addEventListener('click', async () => {
    const rows = document.querySelectorAll('#scan-table-body tr');
    let importedCount = 0;

    const importDate = document.getElementById('scan-input-date')?.value || scanReportDate || today();

    for (const row of rows) {
      const check = row.querySelector('.scan-row-check');
      if (!check || !check.checked) continue;

      const wellNumber = row.querySelector('.in-well')?.value?.trim();
      if (!wellNumber) continue;

      const wellObj = App.wells.find(w => w.well_number === wellNumber);
      const wellId = wellObj ? wellObj.id : `11-${wellNumber}`;

      const meterVal = row.querySelector('.in-meter')?.value?.trim() || null;
      const numOrNull = el => {
        const v = parseFloat(el?.value);
        return isNaN(v) ? null : v;
      };

      await saveMeasurement({
        well_id: wellId,
        date: importDate,
        time: row.querySelector('.in-time')?.value?.trim() || now(),
        meter_reading: meterVal,
        flow_rate_q: numOrNull(row.querySelector('.in-q')),
        p_buf: numOrNull(row.querySelector('.in-pbuf')),
        p_zat: numOrNull(row.querySelector('.in-pzat')),
        temperature: numOrNull(row.querySelector('.in-temp')),
        strokes_per_minute: numOrNull(row.querySelector('.in-strokes')),
        notes: 'Импортировано с фото рапорта',
        timestamp: Date.now()
      });

      importedCount++;
    }

    toast(`✓ Успешно импортировано ${importedCount} замеров`, 'success');
    close();
    await refresh();
  });
}

async function callGeminiVisionApi(apiKey, mimeType, base64Data, promptText) {
  let candidateModels = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite'
  ];

  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      const models = listData.models || [];
      const supported = models
        .filter(m => m.name.includes('gemini-3.5-flash-lite') || m.name.includes('gemini-3.1-flash-lite'))
        .map(m => m.name.replace(/^models\//, ''));
      if (supported.length > 0) {
        candidateModels = [...new Set([...supported, ...candidateModels])];
      }
    }
  } catch (e) {
    console.warn('Cannot list models:', e);
  }

  let lastError = null;
  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mimeType, data: base64Data } },
                { text: promptText }
              ]
            }
          ],
          generationConfig: { temperature: 0.1 }
        })
      });

      const resData = await res.json().catch(() => ({}));
      if (res.ok && resData.candidates?.[0]?.content?.parts?.[0]?.text) {
        return resData.candidates[0].content.parts[0].text;
      }

      const msg = resData.error?.message || `Status ${res.status}`;
      lastError = new Error(msg);
      if (res.status === 404 || msg.includes('not found') || msg.includes('is not found')) {
        continue;
      } else {
        throw new Error(msg);
      }
    } catch (err) {
      lastError = err;
      if (err.message.includes('not found') || err.message.includes('404')) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Модели Gemini оказались недоступны');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
}

function renderScanPreviewTable(records, dateStr) {
  const dateInput = document.getElementById('scan-input-date');
  if (dateInput) dateInput.value = dateStr || today();
  document.getElementById('scan-count-text').innerHTML = `Найдено: <b>${records.length}</b> замеров`;

  const tbody = document.getElementById('scan-table-body');
  const frag = document.createDocumentFragment();

  records.forEach((rec, idx) => {
    const isMatched = App.wells.some(w => w.well_number === String(rec.well_number));
    const tr = document.createElement('tr');
    if (!isMatched) tr.className = 'unmatched';

    tr.innerHTML = `
      <td><input type="checkbox" class="scan-row-check" checked></td>
      <td><input type="text" class="in-well" value="${rec.well_number || ''}" style="width:55px;"></td>
      <td><input type="text" class="in-meter" value="${rec.meter_reading ?? ''}" style="width:75px;"></td>
      <td><input type="number" step="any" class="in-q" value="${rec.flow_rate_q ?? ''}" style="width:45px;"></td>
      <td><input type="number" step="0.1" class="in-pbuf" value="${rec.p_buf ?? ''}" style="width:45px;"></td>
      <td><input type="number" step="0.1" class="in-pzat" value="${rec.p_zat ?? ''}" style="width:45px;"></td>
      <td><input type="number" step="1" class="in-temp" value="${rec.temperature ?? ''}" style="width:40px;"></td>
      <td><input type="number" step="1" class="in-strokes" value="${rec.strokes_per_minute ?? ''}" style="width:45px;"></td>
      <td><input type="text" class="in-time" value="${rec.time || ''}" style="width:50px;"></td>
    `;
    frag.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(frag);
}
