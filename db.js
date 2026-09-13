/**
 * db.js — IndexedDB модуль
 * Таблицы: wells, measurements
 */
'use strict';

const DB_NAME = 'DngPatrolDB';
const DB_VERSION = 2;
let dbInstance = null;

/* ── Открытие базы ───────────────────────────────────────── */
function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = ({ target }) => {
      const db = target.result;
      if (!db.objectStoreNames.contains('wells')) {
        const ws = db.createObjectStore('wells', { keyPath: 'id' });
        ws.createIndex('ptv', 'ptv', { unique: false });
      }
      if (!db.objectStoreNames.contains('measurements')) {
        const ms = db.createObjectStore('measurements', { keyPath: 'id', autoIncrement: true });
        ms.createIndex('well_id', 'well_id', { unique: false });
        ms.createIndex('date', 'date', { unique: false });
        ms.createIndex('well_date', ['well_id', 'date'], { unique: false });
      }
      if (!db.objectStoreNames.contains('pz_records')) {
        const pz = db.createObjectStore('pz_records', { keyPath: 'id', autoIncrement: true });
        pz.createIndex('well_number', 'well_number', { unique: false });
        pz.createIndex('ptv', 'ptv', { unique: false });
        pz.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = async ({ target }) => {
      dbInstance = target.result;
      await seedDefaultWellsIfEmpty(dbInstance);
      resolve(dbInstance);
    };

    req.onerror = ({ target }) => reject(target.error);
  });
}

/* ── Сид скважин (Обновлено 11ПТВ) ───────────────────────── */
async function seedDefaultWellsIfEmpty(db) {
  const count = await new Promise(resolve => {
    const tx = db.transaction('wells', 'readonly');
    const r = tx.objectStore('wells').count();
    r.onsuccess = () => resolve(r.result);
  });

  const isImportedPtv9 = localStorage.getItem('dng_ptv9_updated_v1') === 'true';
  const isImportedPtv10 = localStorage.getItem('dng_ptv10_updated_v1') === 'true';
  if (isImportedPtv9 && isImportedPtv10 && count > 0) return;

  const wells = [
    { id: '9-1166', ptv: 9, well_number: '1166', lat: 45.135585, lon: 51.426911 },
    { id: '9-1167', ptv: 9, well_number: '1167', lat: 45.134965, lon: 51.428691 },
    { id: '9-1169', ptv: 9, well_number: '1169', lat: 45.134348, lon: 51.432685 },
    { id: '9-1255', ptv: 9, well_number: '1255', lat: 45.133126, lon: 51.425754 },
    { id: '9-1256', ptv: 9, well_number: '1256', lat: 45.132733, lon: 51.427562 },
    { id: '9-1257', ptv: 9, well_number: '1257', lat: 45.132254, lon: 51.429473 },
    { id: '9-1258', ptv: 9, well_number: '1258', lat: 45.131903, lon: 51.431317 },
    { id: '9-1346', ptv: 9, well_number: '1346', lat: 45.132034, lon: 51.42445 },
    { id: '9-1439', ptv: 9, well_number: '1439', lat: 45.130565, lon: 51.424699 },
    { id: '9-1440', ptv: 9, well_number: '1440', lat: 45.130162, lon: 51.426401 },
    { id: '9-1441', ptv: 9, well_number: '1441', lat: 45.129789, lon: 51.428291 },
    { id: '9-1533', ptv: 9, well_number: '1533', lat: 45.128301, lon: 51.423681 },
    { id: '9-1534', ptv: 9, well_number: '1534', lat: 45.127884, lon: 51.425377 },
    { id: '9-1535', ptv: 9, well_number: '1535', lat: 45.127436, lon: 51.427322 },
    { id: '9-1536', ptv: 9, well_number: '1536', lat: 45.12698, lon: 51.429235 },
    { id: '9-4347', ptv: 9, well_number: '4347', lat: 45.12906, lon: 51.425011 },
    { id: '9-6447', ptv: 9, well_number: '6447', lat: 45.136703, lon: 51.426699 },
    { id: '9-6499', ptv: 9, well_number: '6499', lat: 45.135282, lon: 51.432044 },
    { id: '9-6565', ptv: 9, well_number: '6565', lat: 45.136078, lon: 51.42959 },
    { id: '9-6601', ptv: 9, well_number: '6601', lat: 45.136238, lon: 51.426248 },
    { id: '9-6602', ptv: 9, well_number: '6602', lat: 45.137412, lon: 51.428177 },
    { id: '9-6603', ptv: 9, well_number: '6603', lat: 45.13476, lon: 51.425343 },
    { id: '9-6609', ptv: 9, well_number: '6609', lat: 45.128643, lon: 51.421431 },
    { id: '9-8187', ptv: 9, well_number: '8187', lat: 45.131226, lon: 51.424153 },
    { id: '9-8188', ptv: 9, well_number: '8188', lat: 45.132368, lon: 51.42583 },
    { id: '10-391D', ptv: 10, well_number: '391D', lat: 45.126322, lon: 51.420739 },
    { id: '10-1627', ptv: 10, well_number: '1627', lat: 45.126804, lon: 51.420158 },
    { id: '10-1628', ptv: 10, well_number: '1628', lat: 45.127551, lon: 51.42049 },
    { id: '10-1630', ptv: 10, well_number: '1630', lat: 45.126762, lon: 51.424133 },
    { id: '10-1631', ptv: 10, well_number: '1631', lat: 45.12638, lon: 51.425812 },
    { id: '10-1632', ptv: 10, well_number: '1632', lat: 45.125889, lon: 51.427612 },
    { id: '10-1795', ptv: 10, well_number: '1795', lat: 45.124038, lon: 51.429782 },
    { id: '10-1900', ptv: 10, well_number: '1900', lat: 45.123041, lon: 51.421373 },
    { id: '10-1901', ptv: 10, well_number: '1901', lat: 45.122665, lon: 51.423153 },
    { id: '10-1903', ptv: 10, well_number: '1903', lat: 45.121868, lon: 51.426835 },
    { id: '10-2012', ptv: 10, well_number: '2012', lat: 45.119966, lon: 51.429003 },
    { id: '10-2110', ptv: 10, well_number: '2110', lat: 45.119252, lon: 51.42571 },
    { id: '10-2400', ptv: 10, well_number: '2400', lat: 45.117837, lon: 51.41958 },
    { id: '10-2402', ptv: 10, well_number: '2402', lat: 45.1168, lon: 51.423947 },
    { id: '10-2405', ptv: 10, well_number: '2405', lat: 45.115186, lon: 51.431756 },
    { id: '10-2407', ptv: 10, well_number: '2407', lat: 45.115226, lon: 51.437149 },
    { id: '10-2409', ptv: 10, well_number: '2409', lat: 45.113536, lon: 51.434978 },
    { id: '10-2446', ptv: 10, well_number: '2446', lat: 45.11538, lon: 51.427834 },
    { id: '10-2447', ptv: 10, well_number: '2447', lat: 45.114974, lon: 51.42964 },
    { id: '10-3876', ptv: 10, well_number: '3876', lat: 45.115905, lon: 51.421956 },
    { id: '10-3879', ptv: 10, well_number: '3879', lat: 45.115123, lon: 51.425149 },
    { id: '10-3880', ptv: 10, well_number: '3880', lat: 45.116813, lon: 51.434564 },
    { id: '10-3944', ptv: 10, well_number: '3944', lat: 45.125611, lon: 51.422509 },
    { id: '10-3945', ptv: 10, well_number: '3945', lat: 45.125229, lon: 51.424345 },
    { id: '10-4488', ptv: 10, well_number: '4488', lat: 45.124911, lon: 51.419194 },
    { id: '10-4489', ptv: 10, well_number: '4489', lat: 45.124619, lon: 51.420575 },
    { id: '10-4642', ptv: 10, well_number: '4642', lat: 45.11895, lon: 51.420582 },
    { id: '10-6611', ptv: 10, well_number: '6611', lat: 45.126198, lon: 51.420027 },
    { id: '12-1259G', ptv: 12, well_number: '1259G', lat: 45.1307, lon: 51.4329 },
    { id: '12-1351G', ptv: 12, well_number: '1351G', lat: 45.1292, lon: 51.4332 },
    { id: '12-1352G', ptv: 12, well_number: '1352G', lat: 45.1288, lon: 51.435 },
    { id: '12-1353G', ptv: 12, well_number: '1353G', lat: 45.1281, lon: 51.4374 },
    { id: '12-1355G', ptv: 12, well_number: '1355G', lat: 45.1277, lon: 51.441 },
    { id: '12-1395', ptv: 12, well_number: '1395', lat: 45.1285, lon: 51.4388 },
    { id: '12-1397', ptv: 12, well_number: '1397', lat: 45.1276, lon: 51.4425 },
    { id: '12-1443', ptv: 12, well_number: '1443', lat: 45.1291, lon: 51.432 },
    { id: '12-1444', ptv: 12, well_number: '1444', lat: 45.1286, lon: 51.4338 },
    { id: '12-1445', ptv: 12, well_number: '1445', lat: 45.1283, lon: 51.4355 },
    { id: '12-1446', ptv: 12, well_number: '1446', lat: 45.1278, lon: 51.4375 },
    { id: '12-1447', ptv: 12, well_number: '1447', lat: 45.1277, lon: 51.4395 },
    { id: '12-1448', ptv: 12, well_number: '1448', lat: 45.1272, lon: 51.4413 },
    { id: '12-1449', ptv: 12, well_number: '1449', lat: 45.1267, lon: 51.4431 },
    { id: '12-1488', ptv: 12, well_number: '1488', lat: 45.1268, lon: 51.4389 },
    { id: '12-1489', ptv: 12, well_number: '1489', lat: 45.1266, lon: 51.441 },
    { id: '12-1490', ptv: 12, well_number: '1490', lat: 45.1261, lon: 51.4428 },
    { id: '12-1537', ptv: 12, well_number: '1537', lat: 45.1265, lon: 51.4309 },
    { id: '12-1538', ptv: 12, well_number: '1538', lat: 45.126, lon: 51.4327 },
    { id: '12-1539', ptv: 12, well_number: '1539', lat: 45.1259, lon: 51.4347 },
    { id: '12-1540', ptv: 12, well_number: '1540', lat: 45.1255, lon: 51.4365 },
    { id: '12-1541', ptv: 12, well_number: '1541', lat: 45.125, lon: 51.4386 },
    { id: '12-1542', ptv: 12, well_number: '1542', lat: 45.1246, lon: 51.4401 },
    { id: '12-1543', ptv: 12, well_number: '1543', lat: 45.1242, lon: 51.4419 },
    { id: '12-1583', ptv: 12, well_number: '1583', lat: 45.1243, lon: 51.4383 },
    { id: '12-1585', ptv: 12, well_number: '1585', lat: 45.1236, lon: 51.4417 },
    { id: '12-1633', ptv: 12, well_number: '1633', lat: 45.1254, lon: 51.4296 },
    { id: '12-1634', ptv: 12, well_number: '1634', lat: 45.1249, lon: 51.4311 },
    { id: '12-1636', ptv: 12, well_number: '1636', lat: 45.1244, lon: 51.4349 },
    { id: '12-1637', ptv: 12, well_number: '1637', lat: 45.1239, lon: 51.4368 },
    { id: '12-1638', ptv: 12, well_number: '1638', lat: 45.1236, lon: 51.4386 },
    { id: '12-1639', ptv: 12, well_number: '1639', lat: 45.1231, lon: 51.4404 },
    { id: '13-1686', ptv: 13, well_number: '1686', lat: 45.1233, lon: 51.4365 },
    { id: '13-1688', ptv: 13, well_number: '1688', lat: 45.1225, lon: 51.4401 },
    { id: '13-1799', ptv: 13, well_number: '1799', lat: 45.1225, lon: 51.4372 },
    { id: '13-1800', ptv: 13, well_number: '1800', lat: 45.1221, lon: 51.4389 },
    { id: '13-1801', ptv: 13, well_number: '1801', lat: 45.1216, lon: 51.4408 },
    { id: '13-1851', ptv: 13, well_number: '1851', lat: 45.1218, lon: 51.4368 },
    { id: '13-1853', ptv: 13, well_number: '1853', lat: 45.121, lon: 51.4405 },
    { id: '13-1908', ptv: 13, well_number: '1908', lat: 45.1198, lon: 51.4357 },
    { id: '13-1909', ptv: 13, well_number: '1909', lat: 45.1195, lon: 51.4377 },
    { id: '13-1910', ptv: 13, well_number: '1910', lat: 45.119, lon: 51.4395 },
    { id: '13-1961', ptv: 13, well_number: '1961', lat: 45.1197, lon: 51.4338 },
    { id: '13-1962', ptv: 13, well_number: '1962', lat: 45.1193, lon: 51.4357 },
    { id: '13-1964', ptv: 13, well_number: '1964', lat: 45.1184, lon: 51.4393 },
    { id: '13-2013', ptv: 13, well_number: '2013', lat: 45.1197, lon: 51.4308 },
    { id: '13-2014', ptv: 13, well_number: '2014', lat: 45.1192, lon: 51.4326 },
    { id: '13-2015', ptv: 13, well_number: '2015', lat: 45.1188, lon: 51.4344 },
    { id: '13-2017', ptv: 13, well_number: '2017', lat: 45.118, lon: 51.4381 },
    { id: '13-2301', ptv: 13, well_number: '2301', lat: 45.1182, lon: 51.4311 },
    { id: '13-2302', ptv: 13, well_number: '2302', lat: 45.1178, lon: 51.4329 },
    { id: '13-2305', ptv: 13, well_number: '2305', lat: 45.1165, lon: 51.4384 },
    { id: '13-2349', ptv: 13, well_number: '2349', lat: 45.1175, lon: 51.4308 },
    { id: '11-1170', ptv: 11, well_number: '1170', lat: 45.134, lon: 51.4344 },
    { id: '11-1171', ptv: 11, well_number: '1171', lat: 45.1336, lon: 51.4361 },
    { id: '11-1172', ptv: 11, well_number: '1172', lat: 45.1332, lon: 51.438 },
    { id: '11-1173', ptv: 11, well_number: '1173', lat: 45.1332, lon: 51.44 },
    { id: '11-1174', ptv: 11, well_number: '1174', lat: 45.1327, lon: 51.4418 },
    { id: '11-1175', ptv: 11, well_number: '1175', lat: 45.1323, lon: 51.4436 },
    { id: '11-1176', ptv: 11, well_number: '1176', lat: 45.1319, lon: 51.4455 },
    { id: '11-1212', ptv: 11, well_number: '1212', lat: 45.1325, lon: 51.4397 },
    { id: '11-1213', ptv: 11, well_number: '1213', lat: 45.1321, lon: 51.4415 },
    { id: '11-1214', ptv: 11, well_number: '1214', lat: 45.1317, lon: 51.4434 },
    { id: '11-1215', ptv: 11, well_number: '1215', lat: 45.1313, lon: 51.4451 },
    { id: '11-1259', ptv: 11, well_number: '1259', lat: 45.1315, lon: 51.4331 },
    { id: '11-1260', ptv: 11, well_number: '1260', lat: 45.1311, lon: 51.4349 },
    { id: '11-1260G', ptv: 11, well_number: '1260G', lat: 45.1304, lon: 51.4345 },
    { id: '11-1261', ptv: 11, well_number: '1261', lat: 45.1307, lon: 51.4366 },
    { id: '11-1261G', ptv: 11, well_number: '1261G', lat: 45.1299, lon: 51.4364 },
    { id: '11-1262', ptv: 11, well_number: '1262', lat: 45.1306, lon: 51.4388 },
    { id: '11-1262G', ptv: 11, well_number: '1262G', lat: 45.1297, lon: 51.4386 },
    { id: '11-1263', ptv: 11, well_number: '1263', lat: 45.1302, lon: 51.4406 },
    { id: '11-1263G', ptv: 11, well_number: '1263G', lat: 45.1295, lon: 51.4403 },
    { id: '11-1264', ptv: 11, well_number: '1264', lat: 45.1298, lon: 51.4425 },
    { id: '11-1265', ptv: 11, well_number: '1265', lat: 45.1293, lon: 51.4443 },
    { id: '11-1303', ptv: 11, well_number: '1303', lat: 45.1299, lon: 51.4385 },
    { id: '11-1305', ptv: 11, well_number: '1305', lat: 45.1291, lon: 51.4421 },
    { id: '11-1306', ptv: 11, well_number: '1306', lat: 45.1287, lon: 51.444 },
    { id: '11-1350', ptv: 11, well_number: '1350', lat: 45.1304, lon: 51.4316 },
    { id: '11-1352', ptv: 11, well_number: '1352', lat: 45.1296, lon: 51.4352 },
    { id: '11-1354', ptv: 11, well_number: '1354', lat: 45.1291, lon: 51.4392 },
    { id: '11-1356', ptv: 11, well_number: '1356', lat: 45.1283, lon: 51.4428 },
    { id: '11-2647', ptv: 11, well_number: '2647', lat: 45.1362, lon: 51.4342 },
    { id: '11-2649', ptv: 11, well_number: '2649', lat: 45.135, lon: 51.4378 },
    { id: '11-2651', ptv: 11, well_number: '2651', lat: 45.134, lon: 51.4416 },
    { id: '11-3030', ptv: 11, well_number: '3030', lat: 45.1373, lon: 51.4284 },
    { id: '11-4249', ptv: 11, well_number: '4249', lat: 45.1321, lon: 51.4385 },
    { id: '11-6566', ptv: 11, well_number: '6566', lat: 45.1362, lon: 51.4323 },
  ];

  const tx = db.transaction('wells', 'readwrite');
  const store = tx.objectStore('wells');
  store.clear();
  wells.forEach(w => store.put(w));
  localStorage.setItem('dng_ptv11_updated_v3', 'true');
  localStorage.setItem('dng_ptv9_updated_v1', 'true');
  localStorage.setItem('dng_ptv10_updated_v1', 'true');
}

/* ── CRUD скважин ────────────────────────────────────────── */
async function getWellsByPtv(ptv) {
  const db = await openDB();
  return new Promise(resolve => {
    const r = db.transaction('wells', 'readonly').objectStore('wells').index('ptv').getAll(Number(ptv));
    r.onsuccess = () => resolve(r.result.sort((a, b) => a.well_number.localeCompare(b.well_number, undefined, { numeric: true })));
  });
}

async function addWell(wellData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('wells', 'readwrite');
    const r = tx.objectStore('wells').put(wellData);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/* ── CRUD замеров ────────────────────────────────────────── */
async function getMeasurementByDate(wellId, dateStr) {
  const db = await openDB();
  return new Promise(resolve => {
    const r = db.transaction('measurements', 'readonly').objectStore('measurements').index('well_date').get([wellId, dateStr]);
    r.onsuccess = () => resolve(r.result || null);
  });
}

async function getLatestMeasurementBefore(wellId, beforeDate) {
  const db = await openDB();
  return new Promise(resolve => {
    const r = db.transaction('measurements', 'readonly').objectStore('measurements').index('well_id').getAll(wellId);
    r.onsuccess = () => {
      const found = r.result
        .filter(m => m.date < beforeDate)
        .sort((a, b) => b.date.localeCompare(a.date));
      resolve(found.length ? found[0] : null);
    };
  });
}

async function getPreviousMeasurementsMap(beforeDate) {
  const db = await openDB();
  return new Promise(resolve => {
    const r = db.transaction('measurements', 'readonly').objectStore('measurements').getAll();
    r.onsuccess = () => {
      const map = new Map();
      const filtered = r.result
        .filter(m => m.date < beforeDate)
        .sort((a, b) => b.date.localeCompare(a.date));
      for (const m of filtered) {
        if (!map.has(m.well_id)) {
          map.set(m.well_id, m);
        }
      }
      resolve(map);
    };
  });
}

async function getLatestReadingBefore(wellId, beforeDate) {
  const m = await getLatestMeasurementBefore(wellId, beforeDate);
  return m?.meter_reading != null && !isNaN(m.meter_reading) ? m.meter_reading : null;
}

async function getMeasurementsForWell(wellId, limit = 7) {
  const db = await openDB();
  return new Promise(resolve => {
    const r = db.transaction('measurements', 'readonly').objectStore('measurements').index('well_id').getAll(wellId);
    r.onsuccess = () => {
      const list = (r.result || [])
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit);
      resolve(list);
    };
  });
}

async function saveMeasurement(data) {
  const existing = await getMeasurementByDate(data.well_id, data.date);
  if (existing) data.id = existing.id;

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction('measurements', 'readwrite').objectStore('measurements').put(data);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function getMeasurementsByDay(dateStr) {
  const db = await openDB();
  return new Promise(resolve => {
    const r = db.transaction('measurements', 'readonly').objectStore('measurements').index('date').getAll(dateStr);
    r.onsuccess = () => resolve(r.result);
  });
}

/* ── CRUD Перезамеров (П/З) ────────────────────────────── */
async function getAllPzRecords() {
  const db = await openDB();
  return new Promise(resolve => {
    const tx = db.transaction('pz_records', 'readonly');
    const store = tx.objectStore('pz_records');
    const req = store.getAll();
    req.onsuccess = () => {
      const records = (req.result || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      resolve(records);
    };
    req.onerror = () => resolve([]);
  });
}

async function savePzRecord(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pz_records', 'readwrite');
    const store = tx.objectStore('pz_records');
    const req = store.put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deletePzRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pz_records', 'readwrite');
    const store = tx.objectStore('pz_records');
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/* ── Экспорт / Импорт ────────────────────────────────────── */
async function exportFullDB() {
  const db = await openDB();
  const dump = { wells: [], measurements: [], pz_records: [] };
  return new Promise(resolve => {
    const tx = db.transaction(['wells', 'measurements', 'pz_records'], 'readonly');
    tx.objectStore('wells').getAll().onsuccess = e => dump.wells = e.target.result;
    tx.objectStore('measurements').getAll().onsuccess = e => dump.measurements = e.target.result;
    tx.objectStore('pz_records').getAll().onsuccess = e => dump.pz_records = e.target.result;
    tx.oncomplete = () => resolve(dump);
  });
}

async function backupDB() {
  return exportFullDB();
}

async function restoreDB(json) {
  if (!json) throw new Error('Пустые данные');
  const db = await openDB();
  const data = Array.isArray(json) ? { measurements: json } : json;

  return new Promise((resolve, reject) => {
    const storesToUse = ['wells', 'measurements'];
    if (db.objectStoreNames.contains('pz_records')) storesToUse.push('pz_records');
    const tx = db.transaction(storesToUse, 'readwrite');

    if (Array.isArray(data.wells) && data.wells.length > 0) {
      const s = tx.objectStore('wells');
      s.clear();
      data.wells.forEach(w => s.put(w));
    }
    if (Array.isArray(data.measurements) && data.measurements.length > 0) {
      const s = tx.objectStore('measurements');
      data.measurements.forEach(m => s.put(m));
    }
    if (Array.isArray(data.pz_records) && data.pz_records.length > 0 && db.objectStoreNames.contains('pz_records')) {
      const s = tx.objectStore('pz_records');
      data.pz_records.forEach(p => s.put(p));
    }

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
