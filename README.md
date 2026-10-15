# Bike Service Tracker BD

A free, fully offline, bilingual (Bangla / English) motorcycle service &
maintenance log for Bangladesh. Log every service, track what you spent,
and never miss the next engine-oil change, brake-pad swap, or chain service.

Live demo: https://fahad3235.github.io/bike-service-tracker-bd/

## Problem

Motorcycle owners in Bangladesh track services in notebooks or memory:
when the engine oil was last changed, what the garage charged, when the
next service is due. Missed oil changes shorten engine life, and nobody
remembers the last brake-pad change. This app digitizes that notebook with
exact math and automatic due reminders.

## Features

- **Bike profiles**  -- name, model, number plate, purchase date, current
  odometer; edit / delete (deleting a bike deletes its service records).
- **Service log**  -- date, odometer, service type (engine oil, oil filter,
  air filter, brake pad, chain, spark plug, tyre, general, other), garage,
  cost, parts replaced, next-service km + date, note.
- **Preset intervals**  -- picking a service type auto-fills the next-service
  km/date from common-guidance intervals (e.g. engine oil: 1,000 km / 60
  days). Presets are editable per entry.
- **Due engine**  -- dashboard shows Overdue (by km or by date) and Due-soon
  (within 100 km or 14 days) items, computed from each bike's latest
  service per type.
- **Spending stats**  -- total spent, services logged, cost per km (total
  cost / odometer range), per-bike totals, last-service date.
- **Validation**  -- future dates, negative costs, and backwards odometer
  readings are rejected inline; next-service values must be at/after the
  current service.
- **Data**  -- JSON export / import with strict validation (malformed files
  rejected, existing data kept intact), typed-DELETE erase-all.
- **Bilingual**  -- EN / Bangla toggle persisted, Bengali digits throughout.
- **Offline-first**  -- zero network requests; everything in localStorage.

## Stack

Vanilla HTML + CSS + JavaScript. No build step, no dependencies, no
framework. Runs as a static site (GitHub Pages).

## Prerequisites

Any modern browser. For tests: Node.js 18+ and a Chromium binary
(only used by the headless smoke test).

## Install / run

Open `index.html` directly, or serve the folder:

```sh
npx serve .
# or
python3 -m http.server 8000
```

## Testing

```sh
node tests/test.js            # 10 unit tests (logic, validation, due engine, import)
node tests/smoke.mjs 1280     # 27 headless-Chrome checks (desktop)
node tests/smoke.mjs 390      # 27 headless-Chrome checks (mobile)
```

The smoke test accepts `?asof=YYYY-MM-DD` in the page URL for a
deterministic "today" (used by the due-engine checks).

## Deployment

Static site: publish the repo root on GitHub Pages (main branch, `/`).

## Limitations

- Service intervals are **common-guidance presets**, not your
  manufacturer's schedule. Check your bike's manual; intervals vary by
  model, riding style, and oil type.
- Costs are user-entered; nothing is fetched from garages or shops.
- Single-device: data lives in the browser's localStorage. Use Export to
  back up or move it.
- Personal tracker, not a workshop management system  -- no customers,
  invoices, or multi-user support.

## Status

MVP complete. See `TEST_RESULTS.md` for the verified test record.
