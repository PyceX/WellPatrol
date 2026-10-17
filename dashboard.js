/**
 * dashboard.js — Логика Сводного Дашборда Мастера и Геолога
 * Включает прямой опрос Google Таблицы, расчет суточных KPI,
 * выявление аномалий и отрисовку сводной таблицы с графиками.
 */
'use strict';

const DEFAULT_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwr_rQfZyZ1SVdHPR3myyR7K7H6O2lXIvldGe-VvHjbH9xJlQDNC4hY99FPak5yBv-CoQ/exec';
const PTV_LIST = [9, 10, 11, 12, 13];
const PULL_COOLDOWN_MS = 120000; // 2 минуты кулдаун (защита от флуда и превышения лимитов Google Sheets)

/* ── Состояние дашборда ───────────────────────────────────── */
const Dash = {
  activeDate: new Date().toLocaleDateString('en-CA'),
  activePtv: 'all',
  activeTableFilter: 'all',
  activeAlertTab: 'drops',
  searchQuery: '',
  allWells: [],
  measurementsToday: [],
  previousMeasurementsMap: new Map(),
  isSyncing: false,
  lastSyncTime: Number(localStorage.getItem('dng_dash_last_sync') || 0),
};

/* ── Утилиты дат и форматирования ─────────────────────────── */
const today = () => new Date().toLocaleDateString('en-CA');

const getYesterday = (dateStr) => {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
};

const fmt = v => (v != null && v !== '') ? v : '—';

function formatMeter(val) {
  if (val == null || val === '' || isNaN(val)) return '—';
  const parts = val.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join('.');
}

function toast(msg, type = 'info') {
  const container = document.getElementById('dash-toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `dash-toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Инициализация страницы ───────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initControls();
  
  // Устанавливаем сегодняшнюю дату в инпут
  const dateInput = document.getElementById('dash-date');
  if (dateInput) dateInput.value = Dash.activeDate;

  // Отображаем время последней успешной синхронизации, если есть
  if (Dash.lastSyncTime > 0) {
    const lastSyncStr = new Date(Dash.lastSyncTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const syncLabel = document.getElementById('dash-sync-time');
    if (syncLabel) syncLabel.textContent = `Синхронизировано: ${lastSyncStr}`;
  }

  // Первичная загрузка из локальной БД (мгновенно)
  await loadDashboardData();

  // Фоновая синхронизация с Google Таблицей при наличии сети
  if (navigator.onLine) {
    syncFromGoogleSheets();
  }
});

/* ── Тема оформления ──────────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('dng_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  const btn = document.getElementById('btn-dash-theme');
  if (btn) {
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('dng_theme', next);
    });
  }
}

/* ── Слушатели элементов управления ───────────────────────── */
function initControls() {
  // Календарь даты
  const dateInput = document.getElementById('dash-date');
  if (dateInput) {
    dateInput.addEventListener('change', async () => {
      Dash.activeDate = dateInput.value || today();
      await loadDashboardData();
      if (navigator.onLine) {
        syncFromGoogleSheets();
      }
    });
  }

  // Фильтр по ПТВ
  const ptvBar = document.getElementById('dash-ptv-bar');
  if (ptvBar) {
    ptvBar.querySelectorAll('.dash-ptv-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ptvBar.querySelectorAll('.dash-ptv-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Dash.activePtv = btn.dataset.ptv;
        applyFiltersAndRender();
      });
    });
  }

  // Кнопка принудительной синхронизации
  const btnSync = document.getElementById('btn-dash-sync');
  if (btnSync) {
    btnSync.addEventListener('click', () => syncFromGoogleSheets(true));
  }

  // Вкладки алертов
  const alertTabBar = document.getElementById('alerts-tab-bar');
  if (alertTabBar) {
    alertTabBar.querySelectorAll('.alert-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        alertTabBar.querySelectorAll('.alert-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Dash.activeAlertTab = btn.dataset.alertTab;
        renderAlertsList();
      });
    });
  }

  // Фильтры над сводной таблицей
  const tableFilters = document.getElementById('table-filter-pills');
  if (tableFilters) {
    tableFilters.querySelectorAll('.table-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tableFilters.querySelectorAll('.table-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Dash.activeTableFilter = btn.dataset.filter;
        renderFullTable();
      });
    });
  }

  // Поиск по номеру скважины
  const searchIn = document.getElementById('table-search-input');
  if (searchIn) {
    searchIn.addEventListener('input', () => {
      Dash.searchQuery = searchIn.value.trim().toLowerCase();
      renderFullTable();
    });
  }


  // Закрытие модального окна
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalBackdrop = document.getElementById('dash-modal-backdrop');
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // Клик по KPI карточкам — быстрая прокрутка / фильтрация
  document.getElementById('card-kpi-drops')?.addEventListener('click', () => {
    switchAlertTab('drops');
  });
  document.getElementById('card-kpi-anomalies')?.addEventListener('click', () => {
    switchAlertTab('pressures');
  });
  document.getElementById('card-kpi-zero')?.addEventListener('click', () => {
    switchAlertTab('zeros');
  });
  document.getElementById('card-kpi-progress')?.addEventListener('click', () => {
    switchAlertTab('unmeasured');
  });
}

function switchAlertTab(tabName) {
  const alertTabBar = document.getElementById('alerts-tab-bar');
  if (!alertTabBar) return;
  const btn = alertTabBar.querySelector(`[data-alert-tab="${tabName}"]`);
  if (btn) btn.click();
  document.querySelector('.alerts-section')?.scrollIntoView({ behavior: 'smooth' });
}

/* ── Загрузка данных из IndexedDB ─────────────────────────── */
async function loadDashboardData() {
  Dash.allWells = await getAllWells();
  Dash.measurementsToday = await getMeasurementsByDay(Dash.activeDate);
  Dash.previousMeasurementsMap = await getPreviousMeasurementsMap(Dash.activeDate);

  applyFiltersAndRender();
}

/* ── Основной расчет и перерисовка компонентов ────────────── */
function applyFiltersAndRender() {
  // Фильтрация скважин по выбранному ПТВ
  let targetWells = [...Dash.allWells];
  if (Dash.activePtv !== 'all') {
    targetWells = targetWells.filter(w => Number(w.ptv) === Number(Dash.activePtv));
  }

  const mapToday = new Map(Dash.measurementsToday.map(m => [m.well_id, m]));
  const prevMap = Dash.previousMeasurementsMap;

  // 1. Расчет агрегированных метрик
  let sumQToday = 0;
  let sumQYesterday = 0;
  let measuredCount = 0;
  const dropsList = [];
  const anomaliesList = [];
  const zerosList = [];
  const unmeasuredList = [];

  targetWells.forEach(w => {
    const m = mapToday.get(w.id);
    const pm = prevMap.get(w.id);

    const prevQ = pm?.flow_rate_q != null ? Number(pm.flow_rate_q) : null;
    const currQ = m?.flow_rate_q != null ? Number(m.flow_rate_q) : null;
    const pBuf = m?.p_buf != null ? Number(m.p_buf) : null;
    const pZat = m?.p_zat != null ? Number(m.p_zat) : null;

    if (m) {
      measuredCount++;
      if (currQ != null) {
        sumQToday += currQ;
      }
      if (prevQ != null) {
        sumQYesterday += prevQ;
      }

      // Проверка падения дебита: разница >= 3 м³ или падение более 20%
      if (prevQ != null && currQ != null && (prevQ - currQ >= 3 || (prevQ > 5 && (prevQ - currQ) / prevQ >= 0.2))) {
        dropsList.push({
          well: w,
          current: currQ,
          previous: prevQ,
          diff: currQ - prevQ,
          measurement: m
        });
      }

      // Проверка аномалий давления
      const isZeroPbuf = pBuf != null && pBuf <= 0;
      const isHighPzat = pZat != null && pZat >= 5.0;
      const isPressureMismatch = (pBuf != null && pZat != null && (pZat - pBuf >= 3.5));
      if (isZeroPbuf || isHighPzat || isPressureMismatch) {
        let reason = '';
        if (isZeroPbuf) reason = 'P буф ≤ 0 атм (остановка / перекрытие)';
        else if (isHighPzat) reason = `Высокое P зат: ${pZat} атм`;
        else reason = `Перепад: Pз (${pZat}) >> Pб (${pBuf})`;

        anomaliesList.push({
          well: w,
          pBuf: pBuf,
          pZat: pZat,
          reason: reason,
          measurement: m
        });
      }

      // Проверка нулевого дебита
      if (currQ === 0) {
        zerosList.push({
          well: w,
          measurement: m,
          reason: 'Дебит Q = 0 м³/сут'
        });
      }

    } else {
      unmeasuredList.push(w);
    }
  });

  // Сохраняем расчетные списки для рендера
  Dash.calculated = {
    totalWells: targetWells.length,
    measuredCount: measuredCount,
    sumQToday: sumQToday,
    sumQYesterday: sumQYesterday,
    diffQ: sumQToday - sumQYesterday,
    drops: dropsList.sort((a, b) => a.diff - b.diff), // от максимального падения
    anomalies: anomaliesList,
    zeros: zerosList,
    unmeasured: unmeasuredList,
    mapToday: mapToday,
    prevMap: prevMap,
    targetWells: targetWells
  };

  // 2. Отрисовка блоков
  renderKpis();
  renderPtvCards();
  renderAlertsList();
  renderFullTable();
}

/* ── Рендер KPI Карточек ──────────────────────────────────── */
function renderKpis() {
  const c = Dash.calculated;
  if (!c) return;

  // Суточная добыча
  document.getElementById('val-total-q').textContent = Math.round(c.sumQToday).toLocaleString('ru-RU');
  const diffEl = document.getElementById('diff-total-q');
  const diffRound = Math.round(c.diffQ);
  if (diffRound > 0) {
    diffEl.className = 'kpi-diff up';
    diffEl.textContent = `▲ +${diffRound} м³`;
  } else if (diffRound < 0) {
    diffEl.className = 'kpi-diff down';
    diffEl.textContent = `▼ ${diffRound} м³`;
  } else {
    diffEl.className = 'kpi-diff neutral';
    diffEl.textContent = `— 0 м³`;
  }
  document.getElementById('subtext-total-q').textContent = `Вчера: ${Math.round(c.sumQYesterday).toLocaleString('ru-RU')} м³`;

  // Прогресс замера
  const pct = c.totalWells > 0 ? Math.round((c.measuredCount / c.totalWells) * 100) : 0;
  document.getElementById('val-progress-pct').textContent = `${pct}%`;
  document.getElementById('val-progress-counts').textContent = `(${c.measuredCount} / ${c.totalWells})`;
  document.getElementById('fill-progress').style.width = `${pct}%`;
  document.getElementById('subtext-progress').textContent = `Осталось замерить: ${c.totalWells - c.measuredCount} скв.`;

  // Падения
  document.getElementById('val-drops-count').textContent = c.drops.length;
  document.getElementById('badge-tab-drops').textContent = c.drops.length;

  // Аномалии
  document.getElementById('val-anomalies-count').textContent = c.anomalies.length;
  document.getElementById('badge-tab-pressures').textContent = c.anomalies.length;

  // Нули
  document.getElementById('val-zero-count').textContent = c.zeros.length;
  document.getElementById('badge-tab-zeros').textContent = c.zeros.length;

  // Не замерены
  document.getElementById('badge-tab-unmeasured').textContent = c.unmeasured.length;
}

/* ── Рендер сводки по кустам (ПТВ 9-13) ────────────────────── */
function renderPtvCards() {
  const container = document.getElementById('ptv-summary-container');
  if (!container) return;

  const frag = document.createDocumentFragment();

  PTV_LIST.forEach(ptvNum => {
    const ptvWells = Dash.allWells.filter(w => Number(w.ptv) === ptvNum);
    if (!ptvWells.length) return;

    const mapToday = new Map(Dash.measurementsToday.map(m => [m.well_id, m]));
    const prevMap = Dash.previousMeasurementsMap;

    let ptvQ = 0;
    let ptvQYesterday = 0;
    let ptvDone = 0;
    let ptvPbufSum = 0;
    let ptvPzatSum = 0;
    let ptvPbufCount = 0;
    let ptvPzatCount = 0;
    let hasAlert = false;

    ptvWells.forEach(w => {
      const m = mapToday.get(w.id);
      const pm = prevMap.get(w.id);

      if (m) {
        ptvDone++;
        if (m.flow_rate_q != null) ptvQ += Number(m.flow_rate_q);
        if (pm?.flow_rate_q != null) ptvQYesterday += Number(pm.flow_rate_q);
        if (m.p_buf != null) { ptvPbufSum += Number(m.p_buf); ptvPbufCount++; }
        if (m.p_zat != null) { ptvPzatSum += Number(m.p_zat); ptvPzatCount++; }

        // Проверка алертов
        const diff = (pm?.flow_rate_q != null && m.flow_rate_q != null) ? (Number(m.flow_rate_q) - Number(pm.flow_rate_q)) : 0;
        if (diff <= -3 || (m.p_buf != null && m.p_buf <= 0)) {
          hasAlert = true;
        }
      }
    });

    const avgPbuf = ptvPbufCount > 0 ? (ptvPbufSum / ptvPbufCount).toFixed(1) : '—';
    const avgPzat = ptvPzatCount > 0 ? (ptvPzatSum / ptvPzatCount).toFixed(1) : '—';
    const ptvDiff = Math.round(ptvQ - ptvQYesterday);

    const card = document.createElement('div');
    card.className = 'ptv-summary-card';
    card.innerHTML = `
      <div class="ptv-card-top">
        <span class="ptv-card-name">ПТВ-${ptvNum}</span>
        <span class="ptv-card-badge ${hasAlert ? 'alert' : 'ok'}">${hasAlert ? '⚠️ Алерты' : 'В норме ✓'}</span>
      </div>
      <div class="ptv-card-stats">
        <div class="ptv-stat-item">
          <span class="ptv-stat-label">Замерено:</span>
          <span class="ptv-stat-val">${ptvDone} / ${ptvWells.length}</span>
        </div>
        <div class="ptv-stat-item">
          <span class="ptv-stat-label">Добыча:</span>
          <span class="ptv-stat-val">${Math.round(ptvQ)} м³ <small style="color:${ptvDiff >= 0 ? 'var(--c-success)' : 'var(--c-danger)'};">${ptvDiff >= 0 ? '+' : ''}${ptvDiff}</small></span>
        </div>
        <div class="ptv-stat-item">
          <span class="ptv-stat-label">Ср. P буф:</span>
          <span class="ptv-stat-val">${avgPbuf} атм</span>
        </div>
        <div class="ptv-stat-item">
          <span class="ptv-stat-label">Ср. P зат:</span>
          <span class="ptv-stat-val">${avgPzat} атм</span>
        </div>
      </div>
    `;

    // Клик по кусту активирует фильтр
    card.addEventListener('click', () => {
      const ptvBar = document.getElementById('dash-ptv-bar');
      if (ptvBar) {
        const targetBtn = ptvBar.querySelector(`[data-ptv="${ptvNum}"]`);
        if (targetBtn) targetBtn.click();
      }
    });

    frag.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(frag);
}

/* ── Рендер блока алертов ─────────────────────────────────── */
function renderAlertsList() {
  const container = document.getElementById('alerts-list-container');
  if (!container || !Dash.calculated) return;

  const tab = Dash.activeAlertTab;
  const c = Dash.calculated;
  const frag = document.createDocumentFragment();

  if (tab === 'drops') {
    if (!c.drops.length) {
      container.innerHTML = '<div class="alert-empty-text">✓ Скважин с резким падением дебита не обнаружено</div>';
      return;
    }
    c.drops.forEach(item => {
      const card = document.createElement('div');
      card.className = 'alert-item-card border-red';
      card.innerHTML = `
        <div class="alert-well-title">
          <span>№ ${item.well.well_number}</span>
          <span class="alert-well-ptv">ПТВ-${item.well.ptv}</span>
        </div>
        <div class="alert-details">
          <span>Вчера: <b>${item.previous} м³</b></span>
          <span>➔</span>
          <span>Сегодня: <b>${item.current} м³</b></span>
          <span class="alert-tag-change">${item.diff} м³</span>
          <span style="color:var(--c-text-muted); font-size:0.75rem;">⏰ ${item.measurement.time || '—'}</span>
        </div>
      `;
      card.addEventListener('click', () => openWellModal(item.well.id));
      frag.appendChild(card);
    });

  } else if (tab === 'pressures') {
    if (!c.anomalies.length) {
      container.innerHTML = '<div class="alert-empty-text">✓ Аномалий по давлению не зафиксировано</div>';
      return;
    }
    c.anomalies.forEach(item => {
      const card = document.createElement('div');
      card.className = 'alert-item-card border-amber';
      card.innerHTML = `
        <div class="alert-well-title">
          <span>№ ${item.well.well_number}</span>
          <span class="alert-well-ptv">ПТВ-${item.well.ptv}</span>
        </div>
        <div class="alert-details">
          <span>Pб: <b>${fmt(item.pBuf)}</b> атм</span>
          <span>Pз: <b>${fmt(item.pZat)}</b> атм</span>
          <span style="color:var(--c-warning); font-weight:600;">${item.reason}</span>
          <span style="color:var(--c-text-muted); font-size:0.75rem;">⏰ ${item.measurement.time || '—'}</span>
        </div>
      `;
      card.addEventListener('click', () => openWellModal(item.well.id));
      frag.appendChild(card);
    });

  } else if (tab === 'zeros') {
    if (!c.zeros.length) {
      container.innerHTML = '<div class="alert-empty-text">✓ Остановленных скважин с Q=0 нет</div>';
      return;
    }
    c.zeros.forEach(item => {
      const card = document.createElement('div');
      card.className = 'alert-item-card border-gray';
      card.innerHTML = `
        <div class="alert-well-title">
          <span>№ ${item.well.well_number}</span>
          <span class="alert-well-ptv">ПТВ-${item.well.ptv}</span>
        </div>
        <div class="alert-details">
          <span style="color:var(--c-text-muted);">Дебит: <b>0 м³</b></span>
          <span>Pб: ${fmt(item.measurement.p_buf)} | Pз: ${fmt(item.measurement.p_zat)}</span>
          <span style="font-size:0.75rem;">Оператор: ${item.measurement.author || '—'}</span>
        </div>
      `;
      card.addEventListener('click', () => openWellModal(item.well.id));
      frag.appendChild(card);
    });

  } else if (tab === 'unmeasured') {
    if (!c.unmeasured.length) {
      container.innerHTML = '<div class="alert-empty-text">✓ Все скважины замерены! Фонд закрыт на 100%</div>';
      return;
    }
    c.unmeasured.forEach(w => {
      const card = document.createElement('div');
      card.className = 'alert-item-card border-gray';
      card.innerHTML = `
        <div class="alert-well-title">
          <span>№ ${w.well_number}</span>
          <span class="alert-well-ptv">ПТВ-${w.ptv}</span>
        </div>
        <div class="alert-details">
          <span style="color:var(--c-text-dim);">Замер за сегодня еще не внесен оператором</span>
        </div>
      `;
      card.addEventListener('click', () => openWellModal(w.id));
      frag.appendChild(card);
    });
  }

  container.innerHTML = '';
  container.appendChild(frag);
}

/* ── Рендер полной сводной таблицы всех скважин ────────────── */
function renderFullTable() {
  const tbody = document.getElementById('dashboard-table-body');
  const countLabel = document.getElementById('table-count-label');
  if (!tbody || !Dash.calculated) return;

  const c = Dash.calculated;
  const q = Dash.searchQuery;
  const filter = Dash.activeTableFilter;

  let list = [...c.targetWells];

  // Фильтр поиска по номеру скважины
  if (q) {
    list = list.filter(w => w.well_number.toLowerCase().includes(q));
  }

  // Фильтр по статусу
  if (filter === 'done') {
    list = list.filter(w => c.mapToday.has(w.id));
  } else if (filter === 'todo') {
    list = list.filter(w => !c.mapToday.has(w.id));
  } else if (filter === 'drops') {
    const dropWellIds = new Set(c.drops.map(d => d.well.id));
    list = list.filter(w => dropWellIds.has(w.id));
  } else if (filter === 'anomalies') {
    const anomWellIds = new Set(c.anomalies.map(a => a.well.id));
    list = list.filter(w => anomWellIds.has(w.id));
  }

  // Сортировка: по ПТВ, затем по номеру скважины
  list.sort((a, b) => {
    if (a.ptv !== b.ptv) return a.ptv - b.ptv;
    return a.well_number.localeCompare(b.well_number, undefined, { numeric: true });
  });

  countLabel.textContent = `Показано: ${list.length} скважин`;

  const frag = document.createDocumentFragment();

  list.forEach(w => {
    const m = c.mapToday.get(w.id);
    const pm = c.prevMap.get(w.id);

    const prevQ = pm?.flow_rate_q != null ? Number(pm.flow_rate_q) : null;
    const currQ = m?.flow_rate_q != null ? Number(m.flow_rate_q) : null;
    const diffQ = (prevQ != null && currQ != null) ? (currQ - prevQ) : null;
    const isDrop = diffQ != null && diffQ <= -3;
    const isRise = diffQ != null && diffQ >= 3;

    let qCell = fmt(m?.flow_rate_q);
    if (currQ != null && diffQ != null && diffQ !== 0) {
      if (isDrop) {
        qCell = `<span class="badge-q-drop">${currQ} <small>(▼${Math.abs(diffQ)})</small></span>`;
      } else if (isRise) {
        qCell = `<span class="badge-q-rise">${currQ} <small>(▲${diffQ})</small></span>`;
      }
    }

    const tr = document.createElement('tr');
    if (!m) tr.className = 'row-empty';
    else if (isDrop) tr.className = 'row-drop';

    tr.innerHTML = `
      <td><b>ПТВ-${w.ptv}</b></td>
      <td><b>№ ${w.well_number}</b></td>
      <td>${formatMeter(m?.meter_reading)}</td>
      <td>${qCell}</td>
      <td>${fmt(m?.p_buf)}</td>
      <td>${fmt(m?.p_zat)}</td>
      <td>${fmt(m?.strokes_per_minute)}</td>
      <td>${fmt(m?.temperature)}</td>
      <td>${m?.time || '—'}</td>
      <td>${m?.author || '—'}</td>
      <td class="td-notes-col" title="${m?.notes || ''}">${m?.notes || ''}</td>
    `;

    tr.addEventListener('click', () => openWellModal(w.id));
    frag.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

/* ── Синхронизация с Google Таблицей ──────────────────────── */
async function syncFromGoogleSheets(isManual = false) {
  if (Dash.isSyncing || !DEFAULT_SHEETS_URL || !navigator.onLine) {
    if (isManual && !navigator.onLine) toast('⚠️ Нет соединения с интернетом', 'error');
    return;
  }

  // Кулдаун 2 минуты (защита от флуда и превышения лимитов Google Sheets)
  const elapsed = Date.now() - (Dash.lastSyncTime || 0);
  if (elapsed < PULL_COOLDOWN_MS) {
    if (isManual) {
      const remainingSec = Math.ceil((PULL_COOLDOWN_MS - elapsed) / 1000);
      const min = Math.floor(remainingSec / 60);
      const sec = remainingSec % 60;
      const timeStr = min > 0 ? `${min} мин ${sec} сек` : `${sec} сек`;
      toast(`⏳ Подождите ${timeStr} перед повторным запросом к таблице`, 'warning');
    }
    return;
  }

  Dash.isSyncing = true;
  const btnSync = document.getElementById('btn-dash-sync');
  if (btnSync) btnSync.classList.add('spinning');
  if (isManual) toast('⏳ Загрузка свежих замеров из Google Таблицы...', 'info');

  try {
    const allWells = await getAllWells();
    const date = Dash.activeDate;
    const yDate = getYesterday(date);

    // Загружаем дату и вчерашний день для вычисления динамики
    await fetchAndMergeDate(date, allWells);
    await fetchAndMergeDate(yDate, allWells);

    Dash.lastSyncTime = Date.now();
    localStorage.setItem('dng_dash_last_sync', Dash.lastSyncTime);

    const nowStr = new Date(Dash.lastSyncTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('dash-sync-time').textContent = `Синхронизировано: ${nowStr}`;

    await loadDashboardData();
    if (isManual) toast('✓ Данные успешно обновлены из Google Таблицы!', 'success');

  } catch (err) {
    console.warn('Dashboard sync error:', err);
    if (isManual) toast(`Ошибка синхронизации: ${err.message}`, 'error');
  } finally {
    Dash.isSyncing = false;
    if (btnSync) btnSync.classList.remove('spinning');
  }
}

async function fetchAndMergeDate(date, allWells) {
  try {
    const url = DEFAULT_SHEETS_URL + (DEFAULT_SHEETS_URL.includes('?') ? '&' : '?') + 'action=pull&date=' + encodeURIComponent(date) + '&_t=' + Date.now();
    const resp = await fetch(url);
    const json = await resp.json();
    if (!json || !json.success || !json.data) return false;

    for (const [sheetKey, rows] of Object.entries(json.data)) {
      const ptvNum = parseInt(sheetKey.replace(/[^0-9]/g, ''), 10);
      if (isNaN(ptvNum)) continue;

      const ptvWells = allWells.filter(w => w.ptv === ptvNum);
      if (!ptvWells.length) continue;

      const sheetMap = new Map();
      (rows || []).forEach(r => {
        const num = String(r.wellNum || '').replace(/^#/, '').trim().toLowerCase();
        if (num) sheetMap.set(num, r);
      });

      for (const w of ptvWells) {
        const wNum = String(w.well_number || '').replace(/^#/, '').trim().toLowerCase();
        const sheetItem = sheetMap.get(wNum);

        if (sheetItem) {
          const newMeasData = {
            well_id: w.id,
            date: date,
            time: sheetItem.time || '',
            meter_reading: sheetItem.meter_reading != null ? Number(sheetItem.meter_reading) : null,
            flow_rate_q: sheetItem.flow_rate_q != null ? Number(sheetItem.flow_rate_q) : null,
            p_buf: sheetItem.p_buf != null ? Number(sheetItem.p_buf) : null,
            p_zat: sheetItem.p_zat != null ? Number(sheetItem.p_zat) : null,
            strokes_per_minute: sheetItem.strokes_per_minute != null ? Number(sheetItem.strokes_per_minute) : null,
            temperature: sheetItem.temperature != null ? Number(sheetItem.temperature) : null,
            notes: sheetItem.notes || '',
            author: sheetItem.author || '',
            timestamp: sheetItem.timestamp ? new Date(sheetItem.timestamp).getTime() : Date.now(),
            updated_at: sheetItem.timestamp || new Date().toISOString(),
            synced: true
          };
          await saveMeasurement(newMeasData);
        }
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

/* ── Модальное окно истории и график скважины ─────────────── */
async function openWellModal(wellId) {
  const modal = document.getElementById('dash-modal-well');
  if (!modal) return;

  const well = Dash.allWells.find(w => w.id === wellId);
  if (!well) return;

  document.getElementById('modal-well-number').textContent = `№ ${well.well_number}`;
  document.getElementById('modal-well-ptv').textContent = `ПТВ-${well.ptv}`;

  // Получаем историю за 7-14 замеров
  const history = await getMeasurementsForWell(well.id, 10);
  
  // Рисуем SVG график
  renderSvgChart(history);

  // Заполняем таблицу истории
  const tbody = document.getElementById('modal-history-tbody');
  if (tbody) {
    if (!history.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--c-text-muted); padding:20px;">Нет замеров по этой скважине</td></tr>';
    } else {
      tbody.innerHTML = history.map(m => `
        <tr>
          <td><b>${m.date}</b></td>
          <td>${m.time || '—'}</td>
          <td>${formatMeter(m.meter_reading)}</td>
          <td><b>${fmt(m.flow_rate_q)}</b></td>
          <td>${fmt(m.p_buf)}</td>
          <td>${fmt(m.p_zat)}</td>
          <td>${fmt(m.strokes_per_minute)}</td>
          <td>${m.author || '—'}</td>
          <td class="td-notes-col">${m.notes || ''}</td>
        </tr>
      `).join('');
    }
  }

  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('dash-modal-well')?.classList.add('hidden');
}

/* ── Отрисовка векторного SVG графика (100% офлайн) ────────── */
function renderSvgChart(history) {
  const container = document.getElementById('modal-svg-chart');
  if (!container) return;

  if (!history || history.length < 2) {
    container.innerHTML = '<div style="text-align:center; padding:50px 0; color:var(--c-text-muted); font-size:0.85rem;">Недостаточно данных для графика (нужно минимум 2 замера)</div>';
    return;
  }

  // История идет от свежих к старым — переворачиваем слева направо
  const data = [...history].reverse();
  const W = container.clientWidth || 700;
  const H = 220;
  const padL = 40;
  const padR = 40;
  const padT = 20;
  const padB = 30;

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Находим диапазоны Q и Давлений
  const qVals = data.map(d => Number(d.flow_rate_q) || 0);
  const pBufVals = data.map(d => Number(d.p_buf) || 0);
  const pZatVals = data.map(d => Number(d.p_zat) || 0);

  const maxQ = Math.max(5, ...qVals) * 1.15;
  const maxP = Math.max(4, ...pBufVals, ...pZatVals) * 1.2;

  const getX = i => padL + (i / (data.length - 1)) * plotW;
  const getYQ = val => padT + plotH - ((val || 0) / maxQ) * plotH;
  const getYP = val => padT + plotH - ((val || 0) / maxP) * plotH;

  // Формируем линии SVG
  const makePath = (vals, getYFn) => {
    return vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getYFn(v).toFixed(1)}`).join(' ');
  };

  const pathQ = makePath(qVals, getYQ);
  const pathPbuf = makePath(pBufVals, getYP);
  const pathPzat = makePath(pZatVals, getYP);

  // Сетка и точки
  let dotsHtml = '';
  data.forEach((d, i) => {
    const x = getX(i);
    const dateLabel = (d.date || '').slice(5); // MM-DD

    // Вертикальная линия сетки
    dotsHtml += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="var(--c-border)" stroke-dasharray="2,2" opacity="0.6"/>`;
    // Подпись даты
    dotsHtml += `<text x="${x}" y="${H - 10}" text-anchor="middle" fill="var(--c-text-muted)" font-size="10">${dateLabel}</text>`;

    // Точки
    if (d.flow_rate_q != null) {
      dotsHtml += `<circle cx="${x}" cy="${getYQ(d.flow_rate_q)}" r="4" fill="#00e5ff"><title>Q: ${d.flow_rate_q} м³</title></circle>`;
    }
    if (d.p_buf != null) {
      dotsHtml += `<circle cx="${x}" cy="${getYP(d.p_buf)}" r="3" fill="#f59e0b"><title>Pбуф: ${d.p_buf} атм</title></circle>`;
    }
    if (d.p_zat != null) {
      dotsHtml += `<circle cx="${x}" cy="${getYP(d.p_zat)}" r="3" fill="#10b981"><title>Pзат: ${d.p_zat} атм</title></circle>`;
    }
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
      <!-- Горизонтальные направляющие -->
      <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--c-border)" opacity="0.5"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--c-border)"/>

      <!-- Оси -->
      <text x="${padL - 6}" y="${padT + 10}" text-anchor="end" fill="#00e5ff" font-size="10">${Math.round(maxQ)}</text>
      <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" fill="#00e5ff" font-size="10">0</text>
      <text x="${W - padR + 6}" y="${padT + 10}" text-anchor="start" fill="#f59e0b" font-size="10">${maxP.toFixed(1)}</text>
      <text x="${W - padR + 6}" y="${padT + plotH}" text-anchor="start" fill="#f59e0b" font-size="10">0</text>

      <!-- Трендовые линии -->
      <path d="${pathQ}" fill="none" stroke="#00e5ff" stroke-width="2.5" stroke-linecap="round"/>
      <path d="${pathPbuf}" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="4,2"/>
      <path d="${pathPzat}" fill="none" stroke="#10b981" stroke-width="1.8"/>

      <!-- Сетка и маркеры -->
      ${dotsHtml}
    </svg>
  `;
}
