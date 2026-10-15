'use strict';
/* Node unit tests for bike-service-tracker-bd logic. Run: node tests/test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

test('paisa parsing', () => {
  assert.equal(L.parseBdtToPaisa('1250'), 125000);
  assert.equal(L.parseBdtToPaisa('1250.50'), 125050);
  assert.equal(L.parseBdtToPaisa('1,250.5'), 125050);
  assert.equal(L.parseBdtToPaisa('0'), 0);
  assert.equal(L.parseBdtToPaisa(''), null);
  assert.equal(L.parseBdtToPaisa('abc'), null);
  assert.equal(L.parseBdtToPaisa('-5'), null);
  assert.equal(L.parseBdtToPaisa('10.999'), null);
  assert.equal(L.parseBdtToPaisa('10.5.2'), null);
});

test('money formatting incl. Bengali digits', () => {
  assert.equal(L.fmtMoney(125050, 'en'), '\u09F31,250.50');
  assert.equal(L.fmtMoney(0, 'en'), '\u09F30.00');
  assert.equal(L.fmtMoneyShort(125000, 'en'), '\u09F31,250');
  assert.equal(L.fmtMoney(125050, 'bn'), '\u09F3\u09E7,\u09E8\u09EB\u09E6.\u09EB\u09E6');
  assert.equal(L.toBnDigits('2026-10-15'), '\u09E8\u09E6\u09E8\u09EC-\u09E7\u09E6-\u09E7\u09EB');
});

test('date helpers', () => {
  assert.equal(L.isValidDateStr('2026-02-29'), false);
  assert.equal(L.isValidDateStr('2024-02-29'), true);
  assert.equal(L.addDays('2026-10-15', 60), '2026-12-14');
  assert.equal(L.addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(L.daysBetween('2026-10-01', '2026-10-15'), 14);
  assert.equal(L.getToday('2026-10-15'), '2026-10-15');
});

test('service presets', () => {
  assert.deepEqual(L.presetNext(10000, '2026-10-15', 'engine-oil'), { nextOdo: 11000, nextDate: '2026-12-14' });
  assert.deepEqual(L.presetNext(10000, '2026-10-15', 'tyre'), { nextOdo: 25000, nextDate: '2028-10-14' });
  assert.deepEqual(L.presetNext(10000, '2026-10-15', 'other'), { nextOdo: null, nextDate: '' });
});

test('bike validation', () => {
  const today = '2026-10-15';
  assert.deepEqual(L.validateBike({ name: '  ', odo: 100 }, today), ['required']);
  assert.deepEqual(L.validateBike({ name: 'X', odo: -1 }, today), ['invalidOdo']);
  assert.deepEqual(L.validateBike({ name: 'X', odo: 100, purchaseDate: '2026-10-16' }, today), ['invalidDate']);
  assert.deepEqual(L.validateBike({ name: 'X', odo: 100, purchaseDate: '2026-10-15' }, today), []);
});

test('service validation incl. non-decreasing odometer', () => {
  const today = '2026-10-15';
  const state = { bikes: [{ id: 'b1', name: 'Hero', odo: 12000 }], services: [
    { id: 's1', bikeId: 'b1', date: '2026-10-01', odo: 11000, type: 'engine-oil', costPaisa: 100000 }
  ] };
  const base = { id: 's2', bikeId: 'b1', date: '2026-10-15', odo: 12000, type: 'engine-oil', costPaisa: 50000, nextOdo: null, nextDate: '' };
  assert.deepEqual(L.validateService(base, state, today), []);
  assert.deepEqual(L.validateService({ ...base, odo: 10999 }, state, today), ['invalidOdo']);
  assert.deepEqual(L.validateService({ ...base, date: '2026-10-16' }, state, today), ['invalidDate']);
  assert.deepEqual(L.validateService({ ...base, costPaisa: -1 }, state, today), ['invalidCost']);
  assert.deepEqual(L.validateService({ ...base, type: 'nope' }, state, today), ['required']);
  assert.deepEqual(L.validateService({ ...base, bikeId: 'missing' }, state, today), ['required']);
  assert.deepEqual(L.validateService({ ...base, nextOdo: 11999 }, state, today), ['invalidNextOdo']);
  assert.deepEqual(L.validateService({ ...base, nextDate: '2026-10-14' }, state, today), ['invalidNextDate']);
  // Editing the existing record itself must not trip the odo rule.
  assert.deepEqual(L.validateService({ ...state.services[0], costPaisa: 1 }, state, today), []);
});

test('bike stats + cost per km', () => {
  const bike = { id: 'b1', name: 'Hero', odo: 12500 };
  const services = [
    { id: 's1', bikeId: 'b1', date: '2026-09-01', odo: 10000, type: 'engine-oil', costPaisa: 80000 },
    { id: 's2', bikeId: 'b1', date: '2026-10-01', odo: 12000, type: 'general', costPaisa: 120000 },
    { id: 's3', bikeId: 'b2', date: '2026-10-01', odo: 5000, type: 'engine-oil', costPaisa: 999999 }
  ];
  const st = L.bikeStats(bike, services);
  assert.equal(st.count, 2);
  assert.equal(st.totalPaisa, 200000);
  assert.equal(st.rangeKm, 2000);
  assert.equal(st.costPerKmPaisa, 100); // 200000 paisa / 2000 km
  assert.equal(st.lastDate, '2026-10-01');
  const single = L.bikeStats(bike, [services[0]]);
  assert.equal(single.costPerKmPaisa, null); // no range -> no rate
});

test('due engine: overdue / due-soon / ok', () => {
  const today = '2026-10-15';
  const state = {
    bikes: [{ id: 'b1', name: 'Hero', odo: 12100 }],
    services: [
      // engine-oil: next 11000 km -> overdue by 1100 km
      { id: 's1', bikeId: 'b1', date: '2026-10-01', odo: 10000, type: 'engine-oil', costPaisa: 1, nextOdo: 11000, nextDate: '2026-12-01' },
      // brake-pad: next 12150 km -> due in 50 km (<=100) -> due-soon
      { id: 's2', bikeId: 'b1', date: '2026-10-10', odo: 11500, type: 'brake-pad', costPaisa: 1, nextOdo: 12150, nextDate: '2027-01-01' },
      // chain: far future -> ok, must not appear
      { id: 's3', bikeId: 'b1', date: '2026-10-10', odo: 11500, type: 'chain', costPaisa: 1, nextOdo: 30000, nextDate: '2027-06-01' },
      // tyre: next date 2026-10-20 -> due in 5 days (<=14) -> due-soon
      { id: 's4', bikeId: 'b1', date: '2026-09-01', odo: 9000, type: 'tyre', costPaisa: 1, nextOdo: null, nextDate: '2026-10-20' },
      // air-filter: next date 2026-10-01 -> overdue by 14 days
      { id: 's5', bikeId: 'b1', date: '2026-09-01', odo: 9000, type: 'air-filter', costPaisa: 1, nextOdo: null, nextDate: '2026-10-01' }
    ]
  };
  const dues = L.dueItems(state, today);
  assert.equal(dues.length, 4);
  assert.equal(dues[0].status, 'overdue');
  assert.equal(dues[1].status, 'overdue');
  const overdueTypes = dues.filter(d => d.status === 'overdue').map(d => d.type).sort();
  assert.deepEqual(overdueTypes, ['air-filter', 'engine-oil']);
  const eng = dues.find(d => d.type === 'engine-oil');
  assert.equal(eng.reason, 'overdueByKm');
  assert.equal(eng.n, 1100);
  const air = dues.find(d => d.type === 'air-filter');
  assert.equal(air.reason, 'overdueByDate');
  assert.equal(air.n, 14);
  const brake = dues.find(d => d.type === 'brake-pad');
  assert.equal(brake.status, 'due-soon');
  assert.equal(brake.reason, 'dueInKm');
  assert.equal(brake.n, 50);
  const tyre = dues.find(d => d.type === 'tyre');
  assert.equal(tyre.reason, 'dueInDays');
  assert.equal(tyre.n, 5);
  // Latest service per type wins: older overdue engine-oil must not double-count.
  state.services.push({ id: 's6', bikeId: 'b1', date: '2026-10-14', odo: 12100, type: 'engine-oil', costPaisa: 1, nextOdo: 13100, nextDate: '2026-12-13' });
  assert.equal(L.dueItems(state, today).find(d => d.type === 'engine-oil'), undefined);
});

test('export/import round-trip + strict rejection', () => {
  const state = {
    version: 1, lang: 'bn',
    bikes: [{ id: 'b1', name: 'Hero Splendor', model: 'iSmart', plate: 'DHA-123', purchaseDate: '2024-01-05', odo: 12500 }],
    services: [{ id: 's1', bikeId: 'b1', date: '2026-10-01', odo: 12000, type: 'engine-oil', garage: 'Mirpur', costPaisa: 85000, parts: 'Oil', nextOdo: 13000, nextDate: '2026-12-01', note: '' }]
  };
  const out = L.importData(L.exportData(state));
  assert.equal(out.ok, true);
  assert.deepEqual(out.state, state);
  const bad = [
    'not json',
    '{"version":2,"lang":"en","bikes":[],"services":[]}',
    '{"version":1,"lang":"xx","bikes":[],"services":[]}',
    '{"version":1,"lang":"en","bikes":[],"services":[{"id":"s","bikeId":"ghost","date":"2026-01-01","odo":1,"type":"engine-oil","costPaisa":1}]}',
    '{"version":1,"lang":"en","bikes":[{"id":"b","name":"","odo":1}],"services":[]}',
    '{"version":1,"lang":"en","bikes":[],"services":[{"id":"s","bikeId":"b","date":"2026-13-01","odo":1,"type":"engine-oil","costPaisa":1}]}',
    '{"version":1,"lang":"en","bikes":[],"services":[{"id":"s","bikeId":"b","date":"2026-01-01","odo":1.5,"type":"engine-oil","costPaisa":1}]}',
    '{"version":1,"lang":"en","bikes":[],"services":[{"id":"s","bikeId":"b","date":"2026-01-01","odo":1,"type":"engine-oil","costPaisa":-5}]}',
    '{"version":1,"lang":"en","bikes":[],"services":[{"id":"s","bikeId":"b","date":"2026-01-01","odo":1,"type":"bogus","costPaisa":1}]}'
  ];
  for (const b of bad) {
    const r = L.importData(b);
    assert.equal(r.ok, false, 'should reject: ' + b);
  }
});

test('i18n keys complete in both languages', () => {
  const enKeys = Object.keys(L.I18N.en).sort();
  const bnKeys = Object.keys(L.I18N.bn).sort();
  assert.deepEqual(bnKeys, enKeys);
  for (const k of enKeys) {
    if (k === 'typeNames') continue;
    assert.equal(typeof L.I18N.bn[k], 'string', 'bn missing: ' + k);
    assert.ok(L.I18N.bn[k].length > 0, 'bn empty: ' + k);
  }
  const enTypes = Object.keys(L.I18N.en.typeNames).sort();
  const bnTypes = Object.keys(L.I18N.bn.typeNames).sort();
  assert.deepEqual(bnTypes, enTypes);
  assert.equal(L.t('appTitle', 'bn'), '\u09AC\u09BE\u0987\u0995 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u099F\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09BE\u09B0');
  assert.equal(L.t('nonexistent', 'bn'), 'nonexistent');
});
