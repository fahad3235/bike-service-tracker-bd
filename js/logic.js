'use strict';
/* Bike Service Tracker BD  -- pure logic (no DOM). Shared by browser + node tests.
   All user-visible strings live in I18N below; Bengali is written as \uXXXX
   escapes so every source file stays pure ASCII (push-API argv safety). */

var SERVICE_TYPES = [
  { id: 'engine-oil', km: 1000, days: 60 },
  { id: 'oil-filter', km: 3000, days: 180 },
  { id: 'air-filter', km: 5000, days: 180 },
  { id: 'brake-pad', km: 8000, days: 365 },
  { id: 'chain', km: 10000, days: 365 },
  { id: 'spark-plug', km: 8000, days: 365 },
  { id: 'tyre', km: 15000, days: 730 },
  { id: 'general', km: 2000, days: 90 },
  { id: 'other', km: 0, days: 0 }
];

var BN_DIGITS = ['\u09E6', '\u09E7', '\u09E8', '\u09E9', '\u09EA', '\u09EB', '\u09EC', '\u09ED', '\u09EE', '\u09EF'];
var TAKA = '\u09F3';

function toBnDigits(str) {
  return String(str).replace(/[0-9]/g, function (d) { return BN_DIGITS[+d]; });
}
function localizeNum(str, lang) {
  return lang === 'bn' ? toBnDigits(str) : String(str);
}
function fmtInt(n, lang) {
  var s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return localizeNum(s, lang);
}
function fmtMoney(paisa, lang) {
  var v = (paisa / 100).toFixed(2);
  var parts = v.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return TAKA + localizeNum(parts.join('.'), lang);
}
function fmtMoneyShort(paisa, lang) {
  // Whole-taka display used in stat cards: BDT1,250
  var v = String(Math.round(paisa / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return TAKA + localizeNum(v, lang);
}

function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}
function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function parseDate(s) { return new Date(s + 'T00:00:00Z'); }
function addDays(dateStr, n) {
  var d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
function getToday(asof) {
  if (asof && isValidDateStr(asof)) return asof;
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseBdtToPaisa(input) {
  if (typeof input === 'number') {
    if (!isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  if (typeof input !== 'string') return null;
  var s = input.trim().replace(/,/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  var v = parseFloat(s);
  if (!isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

function emptyState() {
  return { version: 1, lang: 'en', bikes: [], services: [] };
}
function serviceTypeById(id) {
  for (var i = 0; i < SERVICE_TYPES.length; i++) if (SERVICE_TYPES[i].id === id) return SERVICE_TYPES[i];
  return null;
}
function presetNext(odo, date, typeId) {
  var t = serviceTypeById(typeId);
  if (!t) return { nextOdo: null, nextDate: '' };
  return {
    nextOdo: t.km ? odo + t.km : null,
    nextDate: t.days ? addDays(date, t.days) : ''
  };
}
function maxOdoForBike(services, bikeId, excludeId) {
  var m = null;
  services.forEach(function (s) {
    if (s.bikeId === bikeId && s.id !== excludeId && (m === null || s.odo > m)) m = s.odo;
  });
  return m;
}

function validateBike(bike, today) {
  var errs = [];
  if (!bike.name || !String(bike.name).trim()) errs.push('required');
  if (bike.purchaseDate && (!isValidDateStr(bike.purchaseDate) || bike.purchaseDate > today)) errs.push('invalidDate');
  if (bike.odo === undefined || bike.odo === null || isNaN(bike.odo) || bike.odo < 0) errs.push('invalidOdo');
  return errs;
}
function validateService(svc, state, today) {
  var errs = [];
  var bike = null;
  state.bikes.forEach(function (b) { if (b.id === svc.bikeId) bike = b; });
  if (!bike) errs.push('required');
  if (!isValidDateStr(svc.date) || svc.date > today) errs.push('invalidDate');
  if (svc.odo === undefined || svc.odo === null || isNaN(svc.odo) || svc.odo < 0 || Math.floor(svc.odo) !== svc.odo) errs.push('invalidOdo');
  if (svc.costPaisa === undefined || svc.costPaisa === null || isNaN(svc.costPaisa) || svc.costPaisa < 0) errs.push('invalidCost');
  if (!serviceTypeById(svc.type)) errs.push('required');
  if (errs.indexOf('invalidOdo') === -1) {
    var prev = maxOdoForBike(state.services, svc.bikeId, svc.id);
    if (prev !== null && svc.odo < prev) errs.push('invalidOdo');
  }
  if (svc.nextOdo !== null && svc.nextOdo !== undefined && svc.nextOdo !== '' &&
      (isNaN(svc.nextOdo) || svc.nextOdo < svc.odo)) errs.push('invalidNextOdo');
  if (svc.nextDate && (!isValidDateStr(svc.nextDate) || svc.nextDate < svc.date)) errs.push('invalidNextDate');
  return errs;
}

function bikeStats(bike, services) {
  var mine = services.filter(function (s) { return s.bikeId === bike.id; });
  var total = 0;
  var minO = null, maxO = null, lastDate = null;
  mine.forEach(function (s) {
    total += s.costPaisa;
    if (minO === null || s.odo < minO) minO = s.odo;
    if (maxO === null || s.odo > maxO) maxO = s.odo;
    if (!lastDate || s.date > lastDate) lastDate = s.date;
  });
  var range = (minO !== null && maxO !== null) ? maxO - minO : 0;
  return {
    count: mine.length,
    totalPaisa: total,
    lastDate: lastDate,
    costPerKmPaisa: range > 0 ? total / range : null,
    rangeKm: range
  };
}

function dueItems(state, today) {
  var out = [];
  state.bikes.forEach(function (bike) {
    SERVICE_TYPES.forEach(function (t) {
      var latest = null;
      state.services.forEach(function (s) {
        if (s.bikeId === bike.id && s.type === t.id) {
          if (!latest || s.date > latest.date || (s.date === latest.date && s.odo > latest.odo)) latest = s;
        }
      });
      if (!latest) return;
      var hasKm = latest.nextOdo !== null && latest.nextOdo !== undefined && latest.nextOdo !== '';
      var hasDate = !!latest.nextDate;
      if (!hasKm && !hasDate) return;
      var overKm = hasKm && latest.nextOdo <= bike.odo;
      var overDate = hasDate && latest.nextDate < today;
      var soonKm = hasKm && !overKm && (latest.nextOdo - bike.odo) <= 100;
      var soonDate = hasDate && !overDate && daysBetween(today, latest.nextDate) <= 14;
      var status = (overKm || overDate) ? 'overdue' : (soonKm || soonDate) ? 'due-soon' : 'ok';
      if (status === 'ok') return;
      var reason = '';
      if (overKm) reason = 'overdueByKm';
      else if (overDate) reason = 'overdueByDate';
      else if (soonKm) reason = 'dueInKm';
      else reason = 'dueInDays';
      var n = 0;
      if (reason === 'overdueByKm') n = bike.odo - latest.nextOdo;
      else if (reason === 'dueInKm') n = latest.nextOdo - bike.odo;
      else if (reason === 'overdueByDate') n = daysBetween(latest.nextDate, today);
      else n = daysBetween(today, latest.nextDate);
      out.push({ bike: bike, type: t.id, status: status, reason: reason, n: n, nextOdo: latest.nextOdo, nextDate: latest.nextDate });
    });
  });
  var rank = { overdue: 0, 'due-soon': 1 };
  out.sort(function (a, b) {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return a.bike.name.localeCompare(b.bike.name) || a.type.localeCompare(b.type);
  });
  return out;
}

function totals(state) {
  var total = 0;
  state.services.forEach(function (s) { total += s.costPaisa; });
  return { bikes: state.bikes.length, services: state.services.length, totalPaisa: total };
}

/* ---------- strict import/export ---------- */
function exportData(state) {
  return JSON.stringify({ version: 1, lang: state.lang, bikes: state.bikes, services: state.services }, null, 2);
}
function validateImported(obj) {
  var errs = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['badRoot'];
  if (obj.version !== 1) errs.push('badVersion');
  if (obj.lang !== 'en' && obj.lang !== 'bn') errs.push('badLang');
  if (!Array.isArray(obj.bikes) || !Array.isArray(obj.services)) return errs.concat(['badArrays']);
  var bikeIds = {};
  obj.bikes.forEach(function (b, i) {
    if (!b || typeof b !== 'object') { errs.push('badBike' + i); return; }
    if (typeof b.id !== 'string' || !b.id) errs.push('badBike' + i);
    else bikeIds[b.id] = true;
    if (typeof b.name !== 'string' || !b.name.trim()) errs.push('badBike' + i);
    if (typeof b.odo !== 'number' || isNaN(b.odo) || b.odo < 0) errs.push('badBike' + i);
    if (b.purchaseDate && !isValidDateStr(b.purchaseDate)) errs.push('badBike' + i);
    if (b.model !== undefined && typeof b.model !== 'string') errs.push('badBike' + i);
    if (b.plate !== undefined && typeof b.plate !== 'string') errs.push('badBike' + i);
  });
  obj.services.forEach(function (s, i) {
    if (!s || typeof s !== 'object') { errs.push('badService' + i); return; }
    if (typeof s.id !== 'string' || !s.id) errs.push('badService' + i);
    if (!bikeIds[s.bikeId]) errs.push('badService' + i);
    if (!isValidDateStr(s.date)) errs.push('badService' + i);
    if (typeof s.odo !== 'number' || isNaN(s.odo) || s.odo < 0 || Math.floor(s.odo) !== s.odo) errs.push('badService' + i);
    if (typeof s.costPaisa !== 'number' || isNaN(s.costPaisa) || s.costPaisa < 0 || Math.floor(s.costPaisa) !== s.costPaisa) errs.push('badService' + i);
    if (!serviceTypeById(s.type)) errs.push('badService' + i);
    if (s.nextOdo !== null && s.nextOdo !== undefined && s.nextOdo !== '' &&
        (typeof s.nextOdo !== 'number' || isNaN(s.nextOdo) || s.nextOdo < 0)) errs.push('badService' + i);
    if (s.nextDate && !isValidDateStr(s.nextDate)) errs.push('badService' + i);
    if (s.garage !== undefined && typeof s.garage !== 'string') errs.push('badService' + i);
    if (s.parts !== undefined && typeof s.parts !== 'string') errs.push('badService' + i);
    if (s.note !== undefined && typeof s.note !== 'string') errs.push('badService' + i);
  });
  return errs;
}
function importData(jsonStr) {
  var obj;
  try { obj = JSON.parse(jsonStr); } catch (e) { return { ok: false, errors: ['badJson'] }; }
  var errs = validateImported(obj);
  if (errs.length) return { ok: false, errors: errs };
  return {
    ok: true,
    state: {
      version: 1,
      lang: obj.lang,
      bikes: obj.bikes.map(function (b) { return { id: b.id, name: b.name, model: b.model || '', plate: b.plate || '', purchaseDate: b.purchaseDate || '', odo: b.odo }; }),
      services: obj.services.map(function (s) { return { id: s.id, bikeId: s.bikeId, date: s.date, odo: s.odo, type: s.type, garage: s.garage || '', costPaisa: s.costPaisa, parts: s.parts || '', nextOdo: (s.nextOdo === undefined || s.nextOdo === '') ? null : s.nextOdo, nextDate: s.nextDate || '', note: s.note || '' }; })
    }
  };
}

/* ---------- i18n ---------- */
var I18N = {
  en: {
    appTitle: 'Bike Service Tracker', tagline: 'Log every service. Never miss the next one.',
    tabDashboard: 'Dashboard', tabBikes: 'Bikes', tabServices: 'Services', tabData: 'Data',
    langBtn: '\u09AC\u09BE\u0982\u09B2\u09BE',
    totalSpent: 'Total spent', servicesLogged: 'Services logged', bikesCount: 'Bikes', costPerKm: 'Cost per km',
    upcoming: 'Upcoming service', noDue: 'Nothing due \u2014 all services up to date.',
    recentServices: 'Recent services', noServices: 'No service records yet.',
    addBike: 'Add bike', editBike: 'Edit bike', bikeName: 'Bike name', model: 'Model',
    plate: 'Number plate', purchaseDate: 'Purchase date', currentOdo: 'Current odometer (km)',
    save: 'Save', cancel: 'Cancel', edit: 'Edit', del: 'Delete', noBikes: 'No bikes yet \u2014 add your first bike.',
    updateOdo: 'Update odometer', servicesFor: 'Services for', lastService: 'Last service',
    addService: 'Log service', editService: 'Edit service', date: 'Date', odometer: 'Odometer (km)',
    serviceType: 'Service type', garage: 'Garage / workshop', cost: 'Cost (\u09F3)',
    parts: 'Parts replaced', nextOdo: 'Next service at (km)', nextDate: 'Next service by (date)',
    note: 'Note', allBikes: 'All bikes', serviceHistory: 'Service history',
    export: 'Export JSON', import: 'Import JSON', clearAll: 'Erase all data',
    typeDelete: 'Type DELETE to confirm', confirmClear: 'Erase ALL bikes and service records? This cannot be undone.',
    importOk: 'Import successful.', importBad: 'Import rejected: invalid file.',
    cleared: 'All data erased.',
    confirmDeleteBike: 'Delete this bike and all its service records?',
    confirmDeleteService: 'Delete this service record?',
    errRequired: 'This field is required.', errInvalidDate: 'Enter a valid date (not in the future).',
    errInvalidOdo: 'Odometer must be a whole number and must not go backwards.',
    errInvalidCost: 'Cost must be 0 or more (max 2 decimals).',
    errInvalidNextOdo: 'Next-service km must be at or after this reading.',
    errInvalidNextDate: 'Next-service date must be on or after this service date.',
    overdue: 'Overdue', dueSoon: 'Due soon', ok: 'OK',
    overdueByKm: 'overdue by {n} km', overdueByDate: 'overdue by {n} day(s)',
    dueInKm: 'due in {n} km', dueInDays: 'due in {n} day(s)',
    byKm: 'at {n} km', byDate: 'by {n}',
    disclaimer: 'Personal tracker \u2014 service intervals are common-guidance presets, not your manufacturer\u2019s schedule. Check your bike\u2019s manual.',
    typeNames: {
      'engine-oil': 'Engine oil', 'oil-filter': 'Oil filter', 'air-filter': 'Air filter',
      'brake-pad': 'Brake pad', 'chain': 'Chain', 'spark-plug': 'Spark plug',
      'tyre': 'Tyre', 'general': 'General service', 'other': 'Other'
    }
  },
  bn: {
    appTitle: '\u09AC\u09BE\u0987\u0995 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u099F\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09BE\u09B0',
    tagline: '\u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u09B2\u09BF\u0996\u09C7 \u09B0\u09BE\u0996\u09C1\u09A8\u0964 \u09AA\u09B0\u09C7\u09B0\u099F\u09BE \u09AE\u09BF\u09B8 \u0995\u09B0\u09AC\u09C7\u09A8 \u09A8\u09BE\u0964',
    tabDashboard: '\u09A1\u09CD\u09AF\u09BE\u09B6\u09AC\u09CB\u09B0\u09CD\u09A1', tabBikes: '\u09AC\u09BE\u0987\u0995\u09B8\u09AE\u09C2\u09B9',
    tabServices: '\u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8\u09B8\u09AE\u09C2\u09B9', tabData: '\u09A1\u09C7\u099F\u09BE',
    langBtn: 'English',
    totalSpent: '\u09AE\u09CB\u099F \u0996\u09B0\u099A', servicesLogged: '\u09B2\u0997 \u0995\u09B0\u09BE \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8',
    bikesCount: '\u09AC\u09BE\u0987\u0995', costPerKm: '\u09AA\u09CD\u09B0\u09A4\u09BF \u0995\u09BF\u09AE\u09BF \u0996\u09B0\u099A',
    upcoming: '\u0986\u09B8\u09A8\u09CD\u09A8 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8',
    noDue: '\u0995\u09BF\u099B\u09C1\u0987 \u09AC\u09BE\u0995\u09BF \u09A8\u09C7\u0987 \u2014 \u09B8\u09AC \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u0986\u09AA-\u099F\u09C1-\u09A1\u09C7\u099F\u0964',
    recentServices: '\u09B8\u09BE\u09AE\u09CD\u09AA\u09CD\u09B0\u09A4\u09BF\u0995 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8',
    noServices: '\u098F\u0996\u09A8\u09CB \u0995\u09CB\u09A8\u09CB \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u09B0\u09C7\u0995\u09B0\u09CD\u09A1 \u09A8\u09C7\u0987\u0964',
    addBike: '\u09AC\u09BE\u0987\u0995 \u09AF\u09CB\u0997 \u0995\u09B0\u09C1\u09A8', editBike: '\u09AC\u09BE\u0987\u0995 \u09B8\u09AE\u09CD\u09AA\u09BE\u09A6\u09A8\u09BE',
    bikeName: '\u09AC\u09BE\u0987\u0995\u09C7\u09B0 \u09A8\u09BE\u09AE', model: '\u09AE\u09A1\u09C7\u09B2',
    plate: '\u09A8\u09AE\u09CD\u09AC\u09B0 \u09AA\u09CD\u09B2\u09C7\u099F', purchaseDate: '\u0995\u09C7\u09A8\u09BE\u09B0 \u09A4\u09BE\u09B0\u09BF\u0996',
    currentOdo: '\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0993\u09A1\u09CB\u09AE\u09BF\u099F\u09BE\u09B0 (\u0995\u09BF\u09AE\u09BF)',
    save: '\u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3', cancel: '\u09AC\u09BE\u09A4\u09BF\u09B2', edit: '\u09B8\u09AE\u09CD\u09AA\u09BE\u09A6\u09A8\u09BE', del: '\u09AE\u09C1\u099B\u09C1\u09A8',
    noBikes: '\u098F\u0996\u09A8\u09CB \u0995\u09CB\u09A8\u09CB \u09AC\u09BE\u0987\u0995 \u09A8\u09C7\u0987 \u2014 \u09AA\u09CD\u09B0\u09A5\u09AE \u09AC\u09BE\u0987\u0995 \u09AF\u09CB\u0997 \u0995\u09B0\u09C1\u09A8\u0964',
    updateOdo: '\u0993\u09A1\u09CB\u09AE\u09BF\u099F\u09BE\u09B0 \u0986\u09AA\u09A1\u09C7\u099F',
    servicesFor: '\u098F\u09B0 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8', lastService: '\u09B6\u09C7\u09B7 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8',
    addService: '\u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u09B2\u0997 \u0995\u09B0\u09C1\u09A8', editService: '\u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u09B8\u09AE\u09CD\u09AA\u09BE\u09A6\u09A8\u09BE',
    date: '\u09A4\u09BE\u09B0\u09BF\u0996', odometer: '\u0993\u09A1\u09CB\u09AE\u09BF\u099F\u09BE\u09B0 (\u0995\u09BF\u09AE\u09BF)',
    serviceType: '\u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8\u09C7\u09B0 \u09A7\u09B0\u09A8',
    garage: '\u0997\u09CD\u09AF\u09BE\u09B0\u09C7\u099C / \u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u0995\u09B6\u09AA',
    cost: '\u0996\u09B0\u099A (\u09F3)', parts: '\u09AC\u09A6\u09B2\u09BE\u09A8\u09CB \u09AF\u09A8\u09CD\u09A4\u09CD\u09B0\u09BE\u0982\u09B6',
    nextOdo: '\u09AA\u09B0\u09C7\u09B0 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 (\u0995\u09BF\u09AE\u09BF)',
    nextDate: '\u09AA\u09B0\u09C7\u09B0 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8\u09C7\u09B0 \u09A4\u09BE\u09B0\u09BF\u0996',
    note: '\u09AE\u09A8\u09CD\u09A4\u09AC\u09CD\u09AF', allBikes: '\u09B8\u09AC \u09AC\u09BE\u0987\u0995',
    serviceHistory: '\u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u0987\u09A4\u09BF\u09B9\u09BE\u09B8',
    export: 'JSON \u098F\u0995\u09CD\u09B8\u09AA\u09CB\u09B0\u09CD\u099F', import: 'JSON \u0987\u09AE\u09AA\u09CB\u09B0\u09CD\u099F',
    clearAll: '\u09B8\u09AC \u09A1\u09C7\u099F\u09BE \u09AE\u09C1\u099B\u09C1\u09A8',
    typeDelete: 'DELETE \u09B2\u09BF\u0996\u09C7 \u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4 \u0995\u09B0\u09C1\u09A8',
    confirmClear: '\u09B8\u09AC \u09AC\u09BE\u0987\u0995 \u0993 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u09B0\u09C7\u0995\u09B0\u09CD\u09A1 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09AC\u09C7\u09A8? \u098F\u099F\u09BE \u09AB\u09C7\u09B0\u09A4 \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964',
    importOk: '\u0987\u09AE\u09AA\u09CB\u09B0\u09CD\u099F \u09B8\u09AB\u09B2 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964',
    importBad: '\u0987\u09AE\u09AA\u09CB\u09B0\u09CD\u099F \u09AC\u09BE\u09A4\u09BF\u09B2: \u09AD\u09C1\u09B2 \u09AB\u09BE\u0987\u09B2\u0964',
    cleared: '\u09B8\u09AC \u09A1\u09C7\u099F\u09BE \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964',
    confirmDeleteBike: '\u098F\u0987 \u09AC\u09BE\u0987\u0995 \u0993 \u098F\u09B0 \u09B8\u09AC \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u09B0\u09C7\u0995\u09B0\u09CD\u09A1 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09AC\u09C7\u09A8?',
    confirmDeleteService: '\u098F\u0987 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u09B0\u09C7\u0995\u09B0\u09CD\u09A1 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09AC\u09C7\u09A8?',
    errRequired: '\u098F\u0987 \u0998\u09B0\u099F\u09BF \u0986\u09AC\u09B6\u09CD\u09AF\u0995\u0964',
    errInvalidDate: '\u09B8\u09A0\u09BF\u0995 \u09A4\u09BE\u09B0\u09BF\u0996 \u09A6\u09BF\u09A8 (\u09AD\u09AC\u09BF\u09B7\u09CD\u09AF\u09A4\u09C7\u09B0 \u09A4\u09BE\u09B0\u09BF\u0996 \u09A8\u09AF\u09BC)\u0964',
    errInvalidOdo: '\u0993\u09A1\u09CB\u09AE\u09BF\u099F\u09BE\u09B0 \u09AA\u09C2\u09B0\u09CD\u09A3 \u09B8\u0982\u0996\u09CD\u09AF\u09BE \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7 \u0993 \u09AA\u09C7\u099B\u09A8\u09C7 \u09AF\u09BE\u09A4\u09C7 \u09AA\u09BE\u09B0\u09AC\u09C7 \u09A8\u09BE\u0964',
    errInvalidCost: '\u0996\u09B0\u099A \u09E6 \u09AC\u09BE \u09A4\u09BE\u09B0 \u09AC\u09C7\u09B6\u09BF \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7 (\u09B8\u09B0\u09CD\u09AC\u09CB\u099A\u09CD\u099A \u09E8 \u09A6\u09B6\u09AE\u09BF\u0995)\u0964',
    errInvalidNextOdo: '\u09AA\u09B0\u09C7\u09B0 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8\u09C7\u09B0 \u0995\u09BF\u09AE\u09BF \u098F\u0987 \u09B0\u09BF\u09A1\u09BF\u0982-\u098F\u09B0 \u09B8\u09AE\u09BE\u09A8 \u09AC\u09BE \u09AC\u09C7\u09B6\u09BF \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964',
    errInvalidNextDate: '\u09AA\u09B0\u09C7\u09B0 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8\u09C7\u09B0 \u09A4\u09BE\u09B0\u09BF\u0996 \u098F\u0987 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8\u09C7\u09B0 \u09A4\u09BE\u09B0\u09BF\u0996\u09C7\u09B0 \u09B8\u09AE\u09BE\u09A8 \u09AC\u09BE \u09AA\u09B0\u09C7 \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964',
    overdue: '\u09AE\u09C7\u09AF\u09BC\u09BE\u09A6 \u09AA\u09C7\u09B0\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u099A\u09C7',
    dueSoon: '\u09B6\u09C0\u0998\u09CD\u09B0\u0987 \u09A6\u09B0\u0995\u09BE\u09B0', ok: '\u09A0\u09BF\u0995 \u0986\u099B\u09C7',
    overdueByKm: '{n} \u0995\u09BF\u09AE\u09BF \u09AA\u09C7\u09B0\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u099A\u09C7',
    overdueByDate: '{n} \u09A6\u09BF\u09A8 \u09AA\u09C7\u09B0\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u099A\u09C7',
    dueInKm: '{n} \u0995\u09BF\u09AE\u09BF \u09AC\u09BE\u0995\u09BF', dueInDays: '{n} \u09A6\u09BF\u09A8 \u09AC\u09BE\u0995\u09BF',
    byKm: '{n} \u0995\u09BF\u09AE\u09BF\u09A4\u09C7', byDate: '{n} \u09A4\u09BE\u09B0\u09BF\u0996\u09C7\u09B0 \u09AE\u09A7\u09CD\u09AF\u09C7',
    disclaimer: '\u09AC\u09CD\u09AF\u0995\u09CD\u09A4\u09BF\u0997\u09A4 \u099F\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09BE\u09B0 \u2014 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u09AC\u09BF\u09B0\u09A4\u09BF \u09B8\u09BE\u09A7\u09BE\u09B0\u09A3 \u09A8\u09BF\u09B0\u09CD\u09A6\u09C7\u09B6\u09A8\u09BE, \u09AA\u09CD\u09B0\u09B8\u09CD\u09A4\u09C1\u09A4\u0995\u09BE\u09B0\u0995\u09C7\u09B0 \u09B8\u09AE\u09AF\u09BC\u09B8\u09C2\u099A\u09BF \u09A8\u09AF\u09BC\u0964 \u0986\u09AA\u09A8\u09BE\u09B0 \u09AC\u09BE\u0987\u0995\u09C7\u09B0 \u09AE\u09CD\u09AF\u09BE\u09A8\u09C1\u09AF\u09BC\u09BE\u09B2 \u09A6\u09C7\u0996\u09C1\u09A8\u0964',
    typeNames: {
      'engine-oil': '\u0987\u099E\u09CD\u099C\u09BF\u09A8 \u0985\u09AF\u09BC\u09C7\u09B2', 'oil-filter': '\u0985\u09AF\u09BC\u09C7\u09B2 \u09AB\u09BF\u09B2\u09CD\u099F\u09BE\u09B0',
      'air-filter': '\u098F\u09AF\u09BC\u09BE\u09B0 \u09AB\u09BF\u09B2\u09CD\u099F\u09BE\u09B0', 'brake-pad': '\u09AC\u09CD\u09B0\u09C7\u0995 \u09AA\u09CD\u09AF\u09BE\u09A1',
      'chain': '\u099A\u09C7\u0987\u09A8', 'spark-plug': '\u09B8\u09CD\u09AA\u09BE\u09B0\u09CD\u0995 \u09AA\u09CD\u09B2\u09BE\u0997',
      'tyre': '\u099F\u09BE\u09AF\u09BC\u09BE\u09B0', 'general': '\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8', 'other': '\u0985\u09A8\u09CD\u09AF\u09BE\u09A8\u09CD\u09AF'
    }
  }
};

function t(key, lang) {
  var dict = I18N[lang] || I18N.en;
  return dict[key] !== undefined ? dict[key] : (I18N.en[key] || key);
}
function tType(typeId, lang) {
  var dict = I18N[lang] || I18N.en;
  return (dict.typeNames && dict.typeNames[typeId]) || typeId;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SERVICE_TYPES: SERVICE_TYPES, BN_DIGITS: BN_DIGITS, TAKA: TAKA,
    toBnDigits: toBnDigits, localizeNum: localizeNum, fmtInt: fmtInt,
    fmtMoney: fmtMoney, fmtMoneyShort: fmtMoneyShort, uid: uid,
    isValidDateStr: isValidDateStr, parseDate: parseDate, addDays: addDays,
    daysBetween: daysBetween, getToday: getToday, parseBdtToPaisa: parseBdtToPaisa,
    emptyState: emptyState, serviceTypeById: serviceTypeById, presetNext: presetNext,
    maxOdoForBike: maxOdoForBike, validateBike: validateBike, validateService: validateService,
    bikeStats: bikeStats, dueItems: dueItems, totals: totals,
    exportData: exportData, validateImported: validateImported, importData: importData,
    I18N: I18N, t: t, tType: tType
  };
}
