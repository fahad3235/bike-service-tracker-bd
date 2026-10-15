# TEST RESULTS — bike-service-tracker-bd

Run date: 2026-10-15 (Asia/Dhaka), factory slot 10:00, run #63.
Deterministic "today" for smoke tests: `?asof=2026-10-15`.

## Unit tests — 10/10 pass

`node tests/test.js` (node:test, zero dependencies):

- paisa parsing (1250 -> 125000, 1250.50 -> 125050, 1,250.5 -> 125050,
  rejects '', 'abc', '-5', '10.999', '10.5.2')
- money formatting incl. Bengali digits (fmtMoney 125050 en -> BDT1,250.50;
  bn -> BDT + Bengali digits; toBnDigits('2026-10-15') exact)
- date helpers (2026-02-29 invalid, 2024-02-29 valid, +60d, leap +1d,
  daysBetween 14)
- service presets (engine-oil 10000km/2026-10-15 -> 11000 km / 2026-12-14;
  tyre -> 25000 km / 2028-10-14; other -> null/'')
- bike validation (blank name, negative odo, future purchase date)
- service validation incl. non-decreasing odometer (10999 after 11000
  rejected; future date, negative cost, bad type, unknown bike, next-odo
  below reading, next-date before service date all rejected; editing the
  existing record itself does not trip the odo rule)
- bike stats + cost per km (2 services, 200000 paisa, 2000 km range ->
  100 paisa/km; single-service -> null rate)
- due engine (engine-oil overdue by 1100 km; air-filter overdue by 14 days;
  brake-pad due in 50 km; tyre due in 5 days; chain far-future excluded;
  a newer engine-oil service supersedes the older overdue one)
- export/import round-trip (exact deep-equal) + 9 malformed payloads
  rejected (bad JSON, bad version, bad lang, ghost bikeId, blank bike
  name, bad date, fractional odo, negative cost, bogus type)
- i18n keys complete in both languages (EN/BN key sets identical,
  incl. all 9 service-type names)

## Headless-Chrome smoke — 27/27 desktop + 27/27 mobile (390px)

`node tests/smoke.mjs 1280` and `node tests/smoke.mjs 390`
(raw CDP, /opt/meta-chromium/chrome, file:// + ?asof=2026-10-15):

Title, 4 tabs, empty-state message; add bike via real form (card appears,
stat = 1); empty-name blocked inline, still 1 bike; log engine-oil service
(preset next-odo 13000 + next-date 2026-12-09 autofilled); total spent
renders BDT850; backwards odometer blocked inline, still 1 service;
no-overdue state; odo bump to 12950 -> "Due soon" + "due in 50 km";
BN toggle (title + Bengali digit stat), BN persists after reload, data
persists after reload; export JSON parses; wipe -> empty; import restores
1 bike; malformed import rejected with data intact; typed-DELETE erases
all; no horizontal overflow at 1280px and 390px; zero console/page errors
in both runs.

Repairs: 1 test-side fix only (empty-state assertion used innerText, which
excludes the hidden Bikes panel; switched to the panel's textContent).
0 app-logic bugs found.

## Hygiene

- Sources pure ASCII (Bengali emitted as \uXXXX escapes in JS);
  `grep -rP '[^\x00-\x7F]'` returns 0 matches.
- Zero network requests by design (static site, localStorage only).
- Ships EMPTY (no demo bikes/services, no fabricated prices).
