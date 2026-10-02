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
  allWells: [],
  ruler: 0,
  prevMeter: null,
  prevMeas: null,
  autoCalcQ: null,
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
const today = () => new Date().toLocaleDateString('en-CA');
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
  initExcelReportModal();
  initPz();
  initSearch();
  initAddWell();
  initScanOcr();
  initBulkEdit();

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

/* ── Поиск скважины и проверка в БД строго в текущем ПТВ ─ */
function findWellInDb(wellNumberStr) {
  if (!wellNumberStr) return null;
  const clean = String(wellNumberStr).trim().toUpperCase();
  if (!clean) return null;

  // Ищем СТРОГО в скважинах текущего выбранного ПТВ (App.wells)
  const ptvWells = App.wells || [];
  return ptvWells.find(w => String(w.well_number).trim().toUpperCase() === clean) || null;
}

/* ── Поиск скважины по номеру во всей БД (любой ПТВ) ───── */
function findWellByNumber(wellNumberStr) {
  if (!wellNumberStr) return null;
  const clean = String(wellNumberStr).trim().toUpperCase();
  if (!clean) return null;
  const all = App.allWells && App.allWells.length ? App.allWells : [];
  return all.find(w => String(w.well_number).trim().toUpperCase() === clean) || null;
}

function getPtvForWellNumber(wellNumberStr, fallbackPtv = null) {
  if (!wellNumberStr) return fallbackPtv || App.ptv;
  const well = findWellByNumber(wellNumberStr);
  if (well && well.ptv != null) return well.ptv;
  return fallbackPtv || App.ptv;
}

function updatePzPtvBadge(inputElem, badgeElem) {
  if (!inputElem || !badgeElem) return;
  const val = inputElem.value.trim();
  const well = val ? findWellByNumber(val) : null;
  if (well && well.ptv != null) {
    badgeElem.className = 'well-db-badge exist';
    badgeElem.textContent = `✓ ПТВ-${well.ptv}`;
  } else {
    badgeElem.className = 'well-db-badge empty';
    badgeElem.textContent = `ПТВ-${App.ptv}`;
  }
}

function updateWellDbBadge(inputElem) {
  const tr = inputElem.closest('tr');
  if (!tr) return;
  const badgeCell = tr.querySelector('.well-status-cell');
  if (!badgeCell) return;

  const val = inputElem.value.trim();
  const match = findWellInDb(val);

  if (match) {
    badgeCell.innerHTML = `<span class="well-db-badge exist" title="Скважина найдена в ПТВ-${App.ptv}">✓ ПТВ-${App.ptv}</span>`;
    tr.classList.remove('unmatched');
  } else if (val) {
    badgeCell.innerHTML = `<span class="well-db-badge not-exist" title="Скважина № ${val} отсутствует в ПТВ-${App.ptv}! Не будет сохранена!">❌ Нет в ПТВ-${App.ptv}</span>`;
    tr.classList.add('unmatched');
  } else {
    badgeCell.innerHTML = `<span class="well-db-badge empty">—</span>`;
    tr.classList.remove('unmatched');
  }
}

/* ── Обновить всё ────────────────────────────────────────── */
async function refresh() {
  App.allWells = await getAllWells();
  App.wells = App.allWells
    .filter(w => Number(w.ptv) === Number(App.ptv))
    .sort((a, b) => a.well_number.localeCompare(b.well_number, undefined, { numeric: true }));
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
      <td>${fmt(m.strokes_per_minute)}</td>
      <td>${fmt(m.temperature)}</td>
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

  // Установить подсказки (placeholder) для полей, кроме Q факт (оставляем пустым без подсказок)
  document.getElementById('input-meter').placeholder   = prevMeas?.meter_reading != null ? prevMeas.meter_reading : '0';
  document.getElementById('input-flow').placeholder    = '';
  document.getElementById('input-pbuf').placeholder    = prevMeas?.p_buf != null ? prevMeas.p_buf : '0.0';
  document.getElementById('input-pzat').placeholder    = prevMeas?.p_zat != null ? prevMeas.p_zat : '0.0';
  document.getElementById('input-strokes').placeholder = prevMeas?.strokes_per_minute != null ? prevMeas.strokes_per_minute : '0';
  document.getElementById('input-temp').placeholder    = prevMeas?.temperature != null ? prevMeas.temperature : '0';
  const ex = await getMeasurementByDate(well.id, d);
  const fields = {
    'input-time':    ex?.time ?? now(),
    'input-meter':   ex?.meter_reading ?? '',
    'input-flow':    ex?.flow_rate_q ?? '',
    'input-pbuf':    ex?.p_buf ?? (prevMeas?.p_buf ?? ''),
    'input-pzat':    ex?.p_zat ?? (prevMeas?.p_zat ?? ''),
    'input-strokes': ex?.strokes_per_minute ?? (prevMeas?.strokes_per_minute ?? ''),
    'input-temp':    ex?.temperature ?? (prevMeas?.temperature ?? ''),
    'input-notes':   ex?.notes ?? '',
  };
  Object.entries(fields).forEach(([id, v]) => document.getElementById(id).value = v);

  // Инициализация авторасчета Q
  updateAutoCalc();

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

function updateAutoCalc() {
  const meter = document.getElementById('input-meter');
  const flow = document.getElementById('input-flow');
  const badge = document.getElementById('flow-autocalc-badge');
  if (!badge || !flow || !meter) return;

  const v = parseFloat(meter.value);
  if (!isNaN(v) && App.prevMeter != null) {
    const diff = v - App.prevMeter;
    if (diff >= 0) {
      const qVal = formatQ(diff);
      App.autoCalcQ = qVal;
      badge.textContent = `⚡ ${qVal} м³`;
    } else {
      App.autoCalcQ = null;
      badge.textContent = `⚡ Авто`;
    }
  } else {
    App.autoCalcQ = null;
    badge.textContent = `⚡ Авто`;
  }

  // Бокс авторасчета виден ВСЕГДА, пока поле input-flow пустое,
  // и скрывается ТОЛЬКО тогда, когда пользователь начинает вводить значение вручную.
  if (flow.value.trim() === '') {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
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

  meter.addEventListener('input', () => {
    updateAutoCalc();
    checkAnomalies();
  });

  flow.addEventListener('input', () => {
    updateAutoCalc();
    checkAnomalies();
  });
  pbuf.addEventListener('input', checkAnomalies);
  pzat.addEventListener('input', checkAnomalies);

  document.getElementById('form-measure').addEventListener('submit', async e => {
    e.preventDefault();
    if (flow.value.trim() === '' && App.autoCalcQ != null) {
      flow.value = App.autoCalcQ;
    }
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
      strokes_per_minute: num('input-strokes'),
      temperature: num('input-temp'),
      notes: mNotes,
      timestamp: Date.now(),
    });

    const isPzChecked = document.getElementById('input-pz-clone')?.checked;
    if (isPzChecked) {
      const wellObj = App.wells.find(w => w.id === wellId) || findWellByNumber(wellId);
      const wellNum = wellObj ? wellObj.well_number : wellId.replace(/^[0-9]+-/, '');
      const targetPtv = wellObj ? wellObj.ptv : getPtvForWellNumber(wellNum, App.ptv);

      await savePzRecord({
        well_number: wellNum,
        well_id: wellId,
        ptv: targetPtv,
        val_1: mMeter,
        time_1: (mDate && mTime) ? `${mDate}T${mTime}` : '',
        val_2: null,
        time_2: null,
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

    let csv = '\uFEFFСкважина;ПТВ;Показания;Q факт;P буф;P зат;Об/Чк;t°C;Время;Дата;Примечание\n';
    wells.forEach(w => {
      const m = map.get(w.id) || {};
      csv += [
        w.well_number, w.ptv,
        m.meter_reading ?? '', m.flow_rate_q ?? '',
        m.p_buf ?? '', m.p_zat ?? '',
        m.strokes_per_minute ?? '', m.temperature ?? '',
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

  // Динамическое обновление индикатора ПТВ при вводе скважины
  document.getElementById('pz-edit-well-number')?.addEventListener('input', function() {
    updatePzPtvBadge(this, document.getElementById('pz-edit-ptv-badge'));
  });

  document.getElementById('pz-clone-well-number')?.addEventListener('input', function() {
    updatePzPtvBadge(this, document.getElementById('pz-clone-ptv-badge'));
  });

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

    if (!wellNum || isNaN(v1)) {
      toast('Заполните номер скважины и Замер 1', 'error');
      return;
    }

    const targetPtv = getPtvForWellNumber(wellNum, App.ptv);

    const record = {
      well_number: wellNum,
      ptv: targetPtv,
      val_1: v1,
      time_1: t1,
      val_2: isNaN(v2) ? null : v2,
      time_2: t2,
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
    const targetPtv = getPtvForWellNumber(newWellNum, sourceRecord.ptv || App.ptv);

    const newRecord = {
      well_number: newWellNum,
      ptv: targetPtv,
      val_1: startVal,
      time_1: startTime || getLocalDatetime(),
      val_2: null,
      time_2: null,
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
  const wellNumInput = document.getElementById('pz-edit-well-number');
  wellNumInput.value = record ? record.well_number : '';
  updatePzPtvBadge(wellNumInput, document.getElementById('pz-edit-ptv-badge'));

  document.getElementById('pz-edit-v1').value = record && record.val_1 != null ? record.val_1 : '';
  document.getElementById('pz-edit-t1').value = record && record.time_1 ? record.time_1 : getLocalDatetime();
  document.getElementById('pz-edit-v2').value = record && record.val_2 != null ? record.val_2 : '';
  document.getElementById('pz-edit-t2').value = record && record.time_2 ? record.time_2 : '';

  document.getElementById('pz-modal-title').textContent = record ? `Скв. № ${record.well_number}` : 'Новый перезамер';
  modal.classList.remove('hidden');
}

function openPzCloneModal(record) {
  const modal = document.getElementById('modal-pz-clone');
  document.getElementById('pz-clone-source-id').value = record.id;
  document.getElementById('pz-clone-well-name').textContent = record.well_number;
  const cloneNumInput = document.getElementById('pz-clone-well-number');
  cloneNumInput.value = record.well_number;
  updatePzPtvBadge(cloneNumInput, document.getElementById('pz-clone-ptv-badge'));

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
    const ptvVal = getPtvForWellNumber(r.well_number, r.ptv);

    if (isDone) {
      card.innerHTML = `
        <div class="pz-card-header">
          <div class="pz-card-title">
            <span class="pz-well-num">Скв. № ${r.well_number}</span>
            ${ptvVal ? `<span class="prev-badge" style="font-size:0.68rem;">ПТВ-${ptvVal}</span>` : ''}
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
            ${ptvVal ? `<span class="prev-badge" style="font-size:0.68rem;">ПТВ-${ptvVal}</span>` : ''}
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
  const dateInput = document.getElementById('scan-input-date');
  const btnAddRow = document.getElementById('btn-scan-add-row');

  if (!btnOpen || !modal) return;

  const close = () => modal.classList.add('hidden');

  btnOpen.addEventListener('click', () => {
    const savedKey = localStorage.getItem('ai_api_key') || localStorage.getItem('gemini_api_key') || '';
    keyInput.value = savedKey;

    document.getElementById('scan-step-1').classList.remove('hidden');
    document.getElementById('scan-loading').classList.add('hidden');
    document.getElementById('scan-step-2').classList.add('hidden');

    fileInput.value = '';
    if (dateInput) {
      dateInput.value = '';
      dateInput.classList.remove('input-error');
    }
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

  if (dateInput) {
    dateInput.addEventListener('change', () => {
      if (dateInput.value.trim()) {
        dateInput.classList.remove('input-error');
      }
    });
  }

  if (btnAddRow) {
    btnAddRow.addEventListener('click', () => {
      const tbody = document.getElementById('scan-table-body');
      if (!tbody) return;
      const tr = createScanTableRow({ time: now() });
      tbody.appendChild(tr);
      updateScanCount();
      const firstIn = tr.querySelector('.in-well');
      if (firstIn) firstIn.focus();
    });
  }

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

      const promptText = `Ты — эксперт по распознаванию промысловой документации и суточных рапортов операторов добычи нефти (Тәуліктік рапорты).
Внимательно проанализируй фото рукописного суточного рапорта и извлеки данные по скважинам.

Правила считывания рукописного текста:
1. 'well_number': Номер скважины из колонки "Ұңғы №" (напр. '1686', '1688', '1799', '1800', '391D', '1263G'). Извлекай ТОЛЬКО номер скважины без лишних слов.
2. 'meter_reading': Показания из колонки "Есептегіш көрсеткіштері". Если замера нет — null.
3. 'flow_rate_q': Значение дебита из колонки "Q нақты". (напр. '16', '79').
4. 'p_buf': Буферное давление из колонки "P буф" (напр. 3.5, 2). Не путай с затрубным давлением.
5. 'p_zat': Затрубное давление из колонки "P зат" (напр. 2.5, 1.5, 0, 0.2).
6. 'strokes_per_minute': Обороты из колонки "об/мин" или Чк (напр. 120, 280, 3, 220, 160, 370). Если колонка пуста — null.
7. 'temperature': Температура "T°C". Если колонка пуста — null.
8. 'time': Время замера из колонки "Уақыты" в формате HH:MM (напр. '08:14', '08:16', '08:50'). Если колонка пуста — null.

Строго сопоставляй значения по строкам таблицы. Не смещай колонки.`;

      const rawText = await callGeminiVisionApi(apiKey, mimeType, base64Data, promptText);

      // Благодаря responseMimeType: application/json ответ гарантированно чистый JSON
      const parsed = JSON.parse(rawText);
      const records = parsed.records || [];

      renderScanPreviewTable(records);

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
    const importDate = dateInput?.value?.trim();

    if (!importDate) {
      toast('⚠️ Пожалуйста, укажите дату рапорта вручную!', 'error');
      if (dateInput) {
        dateInput.classList.add('input-error');
        dateInput.focus();
      }
      return;
    }
    if (dateInput) dateInput.classList.remove('input-error');

    const rows = document.querySelectorAll('#scan-table-body tr');
    let importedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const check = row.querySelector('.scan-row-check');
      if (!check || !check.checked) continue;

      const wellNumber = row.querySelector('.in-well')?.value?.trim();
      if (!wellNumber) continue;

      // ПРОВЕРКА СТРОГО ПО ВЫБРАННОМУ ПТВ (App.wells)
      const matchedWell = findWellInDb(wellNumber);
      if (!matchedWell) {
        // Если скважины нет в выбранном ПТВ — НЕ сохранять в БД!
        skippedCount++;
        continue;
      }

      const wellId = matchedWell.id;

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
        strokes_per_minute: numOrNull(row.querySelector('.in-strokes')),
        temperature: numOrNull(row.querySelector('.in-temp')),
        notes: 'Импортировано с фото рапорта',
        timestamp: Date.now()
      });

      importedCount++;
    }

    if (importedCount > 0) {
      const skipMsg = skippedCount > 0 ? ` (пропущено ${skippedCount} скв. не из ПТВ-${App.ptv})` : '';
      toast(`✓ Успешно импортировано ${importedCount} замеров для ПТВ-${App.ptv}${skipMsg}`, 'success');
    } else {
      toast(`⚠️ Ни один замер не сохранен: скважины отсутствуют в ПТВ-${App.ptv}`, 'error');
    }

    close();
    await refresh();
  });
}

async function callGeminiVisionApi(apiKey, mimeType, base64Data, promptText) {
  const model = 'gemini-3.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Строгая JSON-схема согласно структуре таблицы рапорта
  const jsonSchema = {
    type: 'OBJECT',
    properties: {
      records: {
        type: 'ARRAY',
        description: 'Список замеров по скважинам из рапорта',
        items: {
          type: 'OBJECT',
          properties: {
            well_number: { 
              type: 'STRING', 
              description: 'Номер скважины (напр. 1686, 1799, 1263G, без лишних символов)' 
            },
            meter_reading: { 
              type: 'NUMBER', 
              nullable: true, 
              description: 'Показания счетчика (напр. 6386285)' 
            },
            flow_rate_q: { 
              type: 'NUMBER', 
              nullable: true, 
              description: 'Фактический дебит жидкости Q нақты (м³/сут)' 
            },
            p_buf: { 
              type: 'NUMBER', 
              nullable: true, 
              description: 'Буферное давление P буф (атм)' 
            },
            p_zat: { 
              type: 'NUMBER', 
              nullable: true, 
              description: 'Затрубное давление P зат (атм)' 
            },
            strokes_per_minute: { 
              type: 'NUMBER', 
              nullable: true, 
              description: 'Число качаний / об/мин / Чк' 
            },
            temperature: { 
              type: 'NUMBER', 
              nullable: true, 
              description: 'Температура жидкости t°C' 
            },
            time: { 
              type: 'STRING', 
              nullable: true, 
              description: 'Время замера в формате HH:MM (напр. 08:14)' 
            }
          },
          required: ['well_number']
        }
      }
    },
    required: ['records']
  };

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          },
          {
            text: promptText
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: jsonSchema
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  const resData = await res.json().catch(() => ({}));

  if (res.ok && resData.candidates?.[0]?.content?.parts?.[0]?.text) {
    return resData.candidates[0].content.parts[0].text;
  }

  const msg = resData.error?.message || `Ошибка сервера: Status ${res.status}`;
  throw new Error(msg);
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

function createScanTableRow(rec = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="checkbox" class="scan-row-check" checked></td>
    <td><input type="text" class="in-well" value="${rec.well_number || ''}" style="width:55px;"></td>
    <td class="well-status-cell"></td>
    <td><input type="number" step="any" class="in-meter" value="${rec.meter_reading ?? ''}" style="width:75px;"></td>
    <td><input type="number" step="any" class="in-q" value="${rec.flow_rate_q ?? ''}" style="width:45px;"></td>
    <td><input type="number" step="0.1" class="in-pbuf" value="${rec.p_buf ?? ''}" style="width:45px;"></td>
    <td><input type="number" step="0.1" class="in-pzat" value="${rec.p_zat ?? ''}" style="width:45px;"></td>
    <td><input type="number" step="1" class="in-strokes" value="${rec.strokes_per_minute ?? ''}" style="width:45px;"></td>
    <td><input type="number" step="1" class="in-temp" value="${rec.temperature ?? ''}" style="width:40px;"></td>
    <td><input type="text" class="in-time" value="${rec.time || ''}" style="width:50px;"></td>
    <td><button type="button" class="btn-del-row" title="Удалить строку">&times;</button></td>
  `;

  const wellIn = tr.querySelector('.in-well');
  wellIn.addEventListener('input', () => updateWellDbBadge(wellIn));
  updateWellDbBadge(wellIn);

  tr.querySelector('.btn-del-row').addEventListener('click', () => {
    tr.remove();
    updateScanCount();
  });

  return tr;
}

function renderScanPreviewTable(records) {
  updateScanCount(records ? records.length : 0);
  const tbody = document.getElementById('scan-table-body');
  if (!tbody) return;

  const frag = document.createDocumentFragment();

  (records || []).forEach(rec => {
    const tr = createScanTableRow(rec);
    frag.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(frag);
  updateScanCount();
}

function updateScanCount(forcedCount = null) {
  const tbody = document.getElementById('scan-table-body');
  const count = forcedCount !== null ? forcedCount : (tbody ? tbody.querySelectorAll('tr').length : 0);
  const tag = document.getElementById('scan-count-text');
  if (tag) tag.innerHTML = `Найдено: <b>${count}</b> замеров (ПТВ-${App.ptv})`;
}

/* ── Массовое добавление / редактирование / удаление ───── */
function initBulkEdit() {
  const btnOpen = document.getElementById('btn-open-bulk-edit');
  const modal = document.getElementById('modal-bulk-edit');
  const btnClose = document.getElementById('btn-close-bulk-edit');
  const btnCancel = document.getElementById('btn-cancel-bulk-edit');
  const backdrop = document.getElementById('bulk-edit-backdrop');
  const btnApply = document.getElementById('btn-apply-bulk-edit');
  const tbody = document.getElementById('bulk-table-body');

  if (!btnOpen || !modal) return;

  const close = () => modal.classList.add('hidden');

  btnOpen.addEventListener('click', async () => {
    const activeReportDate = document.getElementById('report-date')?.value || today();
    modal.classList.remove('hidden');
    await loadBulkDataForDate(activeReportDate);
  });

  btnClose.addEventListener('click', close);
  btnCancel.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  btnApply.addEventListener('click', async () => {
    const importDate = document.getElementById('report-date')?.value || today();
    const rows = tbody.querySelectorAll('tr');
    let savedCount = 0;
    let clearedCount = 0;

    for (const tr of rows) {
      const wellId = tr.dataset.wellId;
      if (!wellId) continue;

      const numOrNull = el => {
        const v = parseFloat(el?.value);
        return isNaN(v) ? null : v;
      };

      const meterVal = tr.querySelector('.bulk-in-meter')?.value?.trim() || null;
      const flowQ = numOrNull(tr.querySelector('.bulk-in-q'));
      const pBuf = numOrNull(tr.querySelector('.bulk-in-pbuf'));
      const pZat = numOrNull(tr.querySelector('.bulk-in-pzat'));
      const strokes = numOrNull(tr.querySelector('.bulk-in-strokes'));
      const temp = numOrNull(tr.querySelector('.bulk-in-temp'));
      const timeVal = tr.querySelector('.bulk-in-time')?.value?.trim() || '';
      const notesVal = tr.querySelector('.bulk-in-notes')?.value?.trim() || '';

      const hasData = meterVal !== null || flowQ !== null || pBuf !== null || pZat !== null || strokes !== null || temp !== null || timeVal !== '' || notesVal !== '';

      if (hasData) {
        const measData = {
          well_id: wellId,
          date: importDate,
          time: timeVal || now(),
          meter_reading: meterVal,
          flow_rate_q: flowQ,
          p_buf: pBuf,
          p_zat: pZat,
          strokes_per_minute: strokes,
          temperature: temp,
          notes: notesVal,
          timestamp: Date.now()
        };

        if (tr.dataset.dbId) {
          measData.id = Number(tr.dataset.dbId);
        }

        await saveMeasurement(measData);
        savedCount++;
      } else if (tr.dataset.dbId) {
        // Поля очищены кнопкой "✕" — удаляем замер из БД
        try {
          await deleteMeasurement(Number(tr.dataset.dbId));
          clearedCount++;
        } catch (e) {
          console.error(e);
        }
      }
    }

    if (savedCount > 0 || clearedCount > 0) {
      const clearMsg = clearedCount > 0 ? ` (очищено замеров: ${clearedCount})` : '';
      toast(`✓ Сохранено ${savedCount} замеров для ПТВ-${App.ptv}${clearMsg}`, 'success');
    } else {
      toast(`ℹ️ Нет данных для сохранения`, 'info');
    }

    close();
    await refresh();
  });
}

async function loadBulkDataForDate(dateStr) {
  const tbody = document.getElementById('bulk-table-body');
  if (!tbody) return;

  const allMeasurements = await getMeasurementsByDay(dateStr);
  const ptvWells = [...(App.wells || [])].sort((a, b) =>
    a.well_number.localeCompare(b.well_number, undefined, { numeric: true })
  );
  const measMap = new Map((allMeasurements || []).map(m => [m.well_id, m]));

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  ptvWells.forEach(w => {
    const m = measMap.get(w.id);
    const tr = createBulkTableRow({
      well_id: w.id,
      well_number: w.well_number,
      id: m?.id,
      meter_reading: m?.meter_reading,
      flow_rate_q: m?.flow_rate_q,
      p_buf: m?.p_buf,
      p_zat: m?.p_zat,
      strokes_per_minute: m?.strokes_per_minute,
      temperature: m?.temperature,
      time: m?.time,
      notes: m?.notes
    });
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  updateBulkCount();
}

function createBulkTableRow(data = {}) {
  const tr = document.createElement('tr');
  if (data.id) tr.dataset.dbId = data.id;
  if (data.well_id) tr.dataset.wellId = data.well_id;

  tr.innerHTML = `
    <td><b>${data.well_number || ''}</b></td>
    <td><input type="number" step="any" class="bulk-in-meter" value="${data.meter_reading ?? ''}" style="width:75px;" placeholder="—"></td>
    <td><input type="number" step="any" class="bulk-in-q" value="${data.flow_rate_q ?? ''}" style="width:45px;" placeholder="—"></td>
    <td><input type="number" step="0.1" class="bulk-in-pbuf" value="${data.p_buf ?? ''}" style="width:45px;" placeholder="—"></td>
    <td><input type="number" step="0.1" class="bulk-in-pzat" value="${data.p_zat ?? ''}" style="width:45px;" placeholder="—"></td>
    <td><input type="number" step="1" class="bulk-in-strokes" value="${data.strokes_per_minute ?? ''}" style="width:45px;" placeholder="—"></td>
    <td><input type="number" step="1" class="bulk-in-temp" value="${data.temperature ?? ''}" style="width:40px;" placeholder="—"></td>
    <td><input type="text" class="bulk-in-time" value="${data.time || ''}" style="width:50px;" placeholder="—"></td>
    <td><input type="text" class="bulk-in-notes" value="${data.notes || ''}" placeholder="Прим." style="width:65px;"></td>
    <td><button type="button" class="btn-clear-row" title="Очистить поля этой скважины" style="background:none; border:none; color:var(--c-danger); font-size:1.1rem; font-weight:bold; cursor:pointer; padding:2px 6px;">✕</button></td>
  `;

  tr.querySelector('.btn-clear-row').addEventListener('click', () => {
    tr.querySelectorAll('input').forEach(input => input.value = '');
  });

  return tr;
}

function updateBulkCount() {
  const tbody = document.getElementById('bulk-table-body');
  const count = tbody ? tbody.querySelectorAll('tr').length : 0;
  const tag = document.getElementById('bulk-count-text');
  const activeReportDate = document.getElementById('report-date')?.value || today();
  const parts = activeReportDate.split('-');
  const formattedDate = (parts.length === 3) ? `${parts[2]}.${parts[1]}.${parts[0]}` : activeReportDate;
  if (tag) tag.innerHTML = `<b>${formattedDate}</b> | Скважин в списке: <b>${count}</b> (ПТВ-${App.ptv})`;
}


/* ── Экспорт суточного рапорта в XLSX (для печати) ────────── */
function formatTimeHM(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) {
    if (typeof isoStr === 'string' && isoStr.includes(':')) {
      return isoStr.slice(0, 5);
    }
    return isoStr;
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function initExcelReportModal() {
  const modal = document.getElementById('modal-excel-export');
  const openBtn = document.getElementById('btn-open-excel-export');
  const closeBtn = document.getElementById('btn-close-excel-export');
  const cancelBtn = document.getElementById('btn-cancel-excel-export');
  const backdrop = document.getElementById('excel-export-backdrop');
  const form = document.getElementById('form-excel-export');
  const masterInput = document.getElementById('export-master-fio');
  const operatorInput = document.getElementById('export-operator-fio');
  const label = document.getElementById('excel-export-ptv-date-label');

  if (!modal || !openBtn) return;
  const closeModal = () => modal.classList.add('hidden');

  openBtn.addEventListener('click', () => {
    const selectedDate = document.getElementById('report-date')?.value || today();
    const parts = selectedDate.split('-');
    const formattedDate = (parts.length === 3) ? `${parts[2]}.${parts[1]}.${parts[0]}` : selectedDate;

    if (label) {
      label.textContent = `ПТВ-${App.ptv} | Дата: ${formattedDate}`;
    }

    if (masterInput) masterInput.value = localStorage.getItem('dng_master_fio') || '';
    if (operatorInput) operatorInput.value = localStorage.getItem('dng_operator_fio') || '';

    modal.classList.remove('hidden');
  });

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', closeModal);

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const masterFio = masterInput?.value.trim() || '';
    const operatorFio = operatorInput?.value.trim() || '';

    if (!masterFio || !operatorFio) {
      toast('Заполните Ф.И.О Мастера и Оператора', 'error');
      return;
    }

    localStorage.setItem('dng_master_fio', masterFio);
    localStorage.setItem('dng_operator_fio', operatorFio);

    closeModal();
    try {
      await exportExcelReport(masterFio, operatorFio);
    } catch (err) {
      console.error('XLSX export error:', err);
      toast('Ошибка экспорта XLSX: ' + (err.message || err), 'error');
    }
  });
}

async function exportExcelReport(masterFio, operatorFio) {
  const XlsxPopulate = window.XlsxPopulate;
  if (!XlsxPopulate) {
    toast('Ошибка: библиотека xlsx-populate не загружена', 'error');
    return;
  }

  toast('⏳ Генерируем XLSX рапорт...', 'info');

  const selectedDate = document.getElementById('report-date')?.value || today();
  const parts = selectedDate.split('-');
  const formattedDate = (parts.length === 3) ? `${parts[2]}.${parts[1]}.${parts[0]}` : selectedDate;

  const selectedPtv = App.ptv;
  const targetSheetName = `${selectedPtv}птв`;

  // Fetch template file
  const response = await fetch('Суточный_рапорт.xlsx');
  if (!response.ok) throw new Error('Не удалось загрузить шаблон Суточный_рапорт.xlsx');
  const fileBlob = await response.blob();

  const wb = await XlsxPopulate.fromDataAsync(fileBlob);

  // Keep selected sheet active & visible, hide other PTV sheets to preserve 100% valid OpenXML references for Google Sheets
  wb.sheets().forEach(s => {
    if (s.name() === targetSheetName) {
      s.hidden(false);
      s.active(true);
    } else {
      s.hidden(true);
    }
  });

  const sheet = wb.sheet(targetSheetName);
  if (!sheet) throw new Error(`Лист ${targetSheetName} не найден в шаблоне`);

  // Date cell O1
  sheet.cell('O1').value('Мерзім: ' + formattedDate);

  // Fetch measurements for the selected date
  const dayMeas = await getMeasurementsByDay(selectedDate);
  const measMap = new Map();
  (dayMeas || []).forEach(m => {
    if (m.well_id) measMap.set(String(m.well_id), m);
    const num = String(m.well_id).includes('-') ? String(m.well_id).split('-')[1] : String(m.well_id || '');
    if (num) measMap.set(String(num), m);
  });

  // First find P/Z header row
  let measHeaderRow = null;
  for (let i = 30; i <= 70; i++) {
    const cVal = sheet.cell('C' + i).value();
    const eVal = sheet.cell('E' + i).value();
    if ((cVal && String(cVal).includes('Уақыты')) || (eVal && String(eVal).includes('Ұңғылар'))) {
      measHeaderRow = i;
      break;
    }
  }

  const pzRowsSet = new Set();
  if (measHeaderRow) {
    for (let i = measHeaderRow; i < measHeaderRow + 16; i++) {
      pzRowsSet.add(i);
    }
  }

  // Scan main well table rows dynamically across the entire sheet
  const wellRows = [];
  for (let r = 5; r <= 100; r++) {
    if (pzRowsSet.has(r)) continue;
    const cVal = sheet.cell('C' + r).value();
    if (cVal && (String(cVal).includes('БРИГАДА') || String(cVal).includes('ОПЕРАТОР') || String(cVal).includes('РАЦИЯ'))) {
      continue;
    }
    const bVal = sheet.cell('B' + r).value();
    if (bVal != null) {
      const bStr = String(bVal).trim();
      if (bStr && !bStr.includes('Ұңғы') && !bStr.includes('р/с')) {
        wellRows.push({ row: r, wellNum: bStr });
      }
    }
  }

  // Fill main table: if measurement exists => write all fields (E, F, G, H, K, L, O, P=24, R), else => Q=24
  wellRows.forEach(({ row, wellNum }) => {
    const wId = `${selectedPtv}-${wellNum}`;
    const m = measMap.get(wId) || measMap.get(wellNum);
    if (m) {
      sheet.cell('E' + row).value((m.meter_reading != null && !isNaN(m.meter_reading)) ? Number(m.meter_reading) : null);
      sheet.cell('F' + row).value((m.flow_rate_q != null && !isNaN(m.flow_rate_q)) ? Number(m.flow_rate_q) : null);
      sheet.cell('G' + row).value((m.p_buf != null && !isNaN(m.p_buf)) ? Number(m.p_buf) : null);
      sheet.cell('H' + row).value((m.p_zat != null && !isNaN(m.p_zat)) ? Number(m.p_zat) : null);
      sheet.cell('K' + row).value((m.strokes_per_minute != null && !isNaN(m.strokes_per_minute)) ? Number(m.strokes_per_minute) : null);
      sheet.cell('L' + row).value((m.temperature != null && !isNaN(m.temperature)) ? Number(m.temperature) : null);
      sheet.cell('O' + row).value(m.time ? String(m.time).slice(0, 5) : null);
      sheet.cell('P' + row).value(24);
      sheet.cell('Q' + row).value(null);
      sheet.cell('R' + row).value((m.notes && String(m.notes).trim()) ? String(m.notes).trim() : null);
    } else {
      sheet.cell('E' + row).value(null);
      sheet.cell('F' + row).value(null);
      sheet.cell('G' + row).value(null);
      sheet.cell('H' + row).value(null);
      sheet.cell('K' + row).value(null);
      sheet.cell('L' + row).value(null);
      sheet.cell('O' + row).value(null);
      sheet.cell('P' + row).value(null);
      sheet.cell('Q' + row).value(24);
    }
  });



  const measDataRows = [];
  if (measHeaderRow) {
    let mr = measHeaderRow + 1;
    while (mr < measHeaderRow + 20) {
      const cVal = sheet.cell('C' + mr).value();
      if (cVal && String(cVal).includes('БРИГАДА')) break;
      const aVal = sheet.cell('A' + mr).value();
      if (aVal != null && !isNaN(aVal)) {
        measDataRows.push(mr);
      }
      mr++;
    }
  }

  // Fetch P/Z records for selected PTV & Date
  const allPz = await getAllPzRecords();
  const pzList = (allPz || []).filter(pz => {
    const ptvVal = getPtvForWellNumber ? getPtvForWellNumber(pz.well_number, pz.ptv) : (pz.ptv || selectedPtv);
    if (Number(ptvVal) !== Number(selectedPtv)) return false;

    if (pz.time_1 && pz.time_1.startsWith(selectedDate)) return true;
    if (pz.timestamp) {
      const pzDate = new Date(pz.timestamp).toISOString().slice(0, 10);
      if (pzDate === selectedDate) return true;
    }
    return false;
  });

  const wellRowMap = new Map(wellRows.map(w => [w.wellNum, w.row]));

  // Ensure xf 208 exists in cellXfs for bold centered C cell without right border
  if (wb._styleSheet && wb._styleSheet._node) {
    const cellXfsNode = wb._styleSheet._node.children.find(c => c.name === 'cellXfs');
    if (cellXfsNode && cellXfsNode.children && cellXfsNode.children.length === 208) {
      cellXfsNode.children.push({
        name: 'xf',
        attributes: {
          numFmtId: '0',
          fontId: '6',
          fillId: '0',
          borderId: '13',
          xfId: '0',
          applyFont: '1',
          applyFill: '1',
          applyBorder: '1',
          applyAlignment: '1',
          applyProtection: '1'
        },
        children: [{
          name: 'alignment',
          attributes: { horizontal: 'center', vertical: 'center', wrapText: '1' }
        }]
      });
      cellXfsNode.attributes.count = String(cellXfsNode.children.length);
    }
  }

  pzList.forEach((pz, idx) => {
    if (idx >= measDataRows.length) return;
    const mr = measDataRows[idx];

    // 1. Ұңғы № (formatted as #1910 with Bold, Center, Middle via template xf 185)
    const wNumStr = String(pz.well_number || '').trim();
    const formattedWellNum = wNumStr ? (wNumStr.startsWith('#') ? wNumStr : `#${wNumStr}`) : '';
    const cellB = sheet.cell('B' + mr);
    cellB.value(formattedWellNum);
    cellB._styleId = 185;

    // 2. Уақыты (C..E merged: Bold, Center, Middle, no right border line -> xf 208)
    const t1 = pz.time_1 ? formatTimeHM(pz.time_1) : '';
    const t2 = pz.time_2 ? formatTimeHM(pz.time_2) : '';
    const timeStr = (t1 && t2) ? `${t1} - ${t2}` : (t1 || t2 || '');
    const cellC = sheet.cell('C' + mr);
    cellC.value(timeStr);
    cellC._styleId = 208;

    // 3. Есептегіш көрсеткіштері (G..P merged: Bold, Center, Middle, no left border line -> xf 181)
    const v1 = pz.val_1 != null ? pz.val_1 : '';
    const v2 = pz.val_2 != null ? pz.val_2 : '';
    const meterStr = (v1 !== '' && v2 !== '') ? `${v1} - ${v2}` : (v1 !== '' ? `${v1}` : '');
    const cellG = sheet.cell('G' + mr);
    cellG.value(meterStr);
    cellG._styleId = 181;

    // 4. Өлшем (Q m3: Bold, Center, Middle -> xf 185)
    let qVal = '';
    if (pz.val_1 != null && pz.time_1 && pz.val_2 != null && pz.time_2) {
      const res = calculateVolume(pz.val_1, pz.time_1, pz.val_2, pz.time_2);
      if (res && !res.isError) {
        qVal = res.debit;
      }
    }
    if (!qVal && pz.val_2 != null && pz.val_1 != null) {
      qVal = pz.val_2 - pz.val_1;
    }
    const cellQ = sheet.cell('Q' + mr);
    cellQ.value(qVal);
    cellQ._styleId = 185;

    // 5. Cчёт. түрі (formula =I# referencing matching well row in main table: Bold, Center, Middle -> xf 185)
    const wRow = wellRowMap.get(wNumStr.replace(/^#/, ''));
    if (wRow) {
      const cellR = sheet.cell('R' + mr);
      cellR.formula(`I${wRow}`);
      cellR._styleId = 185;
    }
  });

  // Signatures into Column D (no bold/center override)
  let masterRow = null;
  let operatorRow = null;
  for (let i = 40; i <= 75; i++) {
    const cVal = String(sheet.cell('C' + i).value() || '');
    if (cVal.includes('БРИГАДА ШЕБЕРІ')) masterRow = i;
    if (cVal.includes('ОПЕРАТОР')) operatorRow = i;
  }

  if (masterRow) sheet.cell('D' + masterRow).value(masterFio);
  if (operatorRow) sheet.cell('D' + operatorRow).value(operatorFio);

  // Clean empty <fill/> elements created by xlsx-populate styling to ensure 100% valid OpenXML for Google Sheets and Excel
  if (wb._styleSheet && wb._styleSheet._node) {
    const fillsNode = wb._styleSheet._node.children.find(c => c.name === 'fills');
    if (fillsNode && fillsNode.children) {
      fillsNode.children = fillsNode.children.filter(c => c.children && c.children.length > 0);
    }
  }

  // Download XLSX
  const outBlob = await wb.outputAsync();
  const fileName = `Суточный_рапорт_ПТВ${selectedPtv}_${formattedDate}.xlsx`;
  download(outBlob, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  toast('📥 Суточный рапорт XLSX скачан', 'success');
}
