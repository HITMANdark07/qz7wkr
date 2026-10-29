# Wind Forecast Monitor

A web app for a UK energy supplier's **day-ahead trading desk**. It answers two questions for purchase decisions made in **January 2026**:

1. **What wind forecast was available when we had to decide?** The latest Elexon forecast published before the day-ahead gate (11:00 UK time on D-1), or before a chosen horizon.
2. **How much can we trust it?** Forecast error against actual national wind output: MAE, RMSE, bias, P10/P50/P90, plus error by horizon, by hour of day, and its distribution. The P90 error becomes a *planning buffer*: how much extra power to buy to stay covered 9 hours in 10.
3. **How much wind can we count on tomorrow, hour by hour?** For a chosen confidence (50/80/90/95%), *dependable wind = forecast − that percentile of January's errors for the same hour of day*. It is shown as a line on the chart and as an hourly table that can be copied as CSV into a buying sheet: buy (demand − dependable wind).

**Live app:** https://qz7wkr-one.vercel.app

## Data

Only Elexon BMRS, national level:

| Dataset | Use | Resolution |
|---|---|---|
| [`FUELHH`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream) (`fuelType = WIND`) | Actual generation | 30 min |
| [`WINDFOR`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream) | Forecast runs (`publishTime`, `startTime`) | hourly, a new run about every 3h |

**Scope:** decisions made 1–31 Jan 2026 cover delivery days **2 Jan – 1 Feb 2026**. Forecasts published from 30 Dec 2025 are included so 48h horizons are covered. Forecasts and actuals are compared at hourly target times, where both exist.

**Decision rules**
- *Day-ahead* (default): for each hour of delivery day D, use the newest forecast with `publishTime ≤ D-1 11:00 Europe/London`.
- *Fixed horizon H* (1–48h): use the newest forecast with `publishTime ≤ startTime − H`.

**Error** = forecast − actual. Positive means the forecast promised more wind than arrived, which is the shortfall risk.

## Repository layout

```
├── api/index.py                 Vercel serverless entry (exposes the FastAPI app)
├── backend/
│   ├── app/analytics.py         Domain logic: forecast selection at decision time, error metrics
│   ├── app/main.py              FastAPI routes: /api/meta, /api/day, /api/accuracy, /api/health
│   ├── data/                    Cached Elexon data for the January 2026 window (gzipped CSV, ~110 KB)
│   ├── scripts/fetch_data.py    One-off downloader that rebuilds backend/data from the Elexon API
│   ├── tests/                   pytest: unit tests (selection, DST, metrics) and API tests
│   ├── requirements-dev.txt     Local dev and test dependencies
│   └── Dockerfile
├── frontend/                    React + TypeScript + Vite + Recharts
│   ├── src/App.tsx              Page layout, controls, KPI tiles
│   ├── src/components/Charts.tsx  Day chart, horizon, hour-of-day and histogram charts
│   ├── src/api.ts               Typed API client and formatting helpers
│   ├── nginx.conf, Dockerfile   Production container (serves build, proxies /api)
├── docker-compose.yml           api (:8000) + web (:3000)
├── vercel.json                  Vercel build and routing
├── requirements.txt             Runtime Python dependencies (FastAPI only)
├── .github/workflows/ci.yml     CI: pytest and frontend build
└── docs/plan.html               Design and plan page
```

## Running it

**Docker (recommended)**
```bash
docker compose up --build
# open http://localhost:3000
```

**Without Docker**
```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/uvicorn backend.app.main:app --reload --port 8000      # API
cd frontend && npm install && npm run dev                          # UI on http://localhost:5173
```

**Tests**
```bash
.venv/bin/python -m pytest -q backend
```

**Refresh data from Elexon** (optional; the repo already contains it)
```bash
.venv/bin/python backend/scripts/fetch_data.py
```

## Design notes

- **No database.** The January 2026 window is fixed, historical and small (~20k forecast rows), so it ships with the code as gzipped CSV and loads into memory on first request. This also suits Vercel's read-only serverless filesystem. A live product would add a scheduled ingest job (e.g. every 30 min) writing to Postgres.
- **No pandas.** The analytics are plain Python (`bisect` over sorted publish times per target), which keeps the serverless bundle small and cold starts fast. Metric results are memoised per (mode, horizon).
- **Time zones.** Gate closure and delivery days are computed in `Europe/London`, so the rules stay correct across BST changes (covered by tests).

## Use of AI tools

This project was built with help from **Claude Code (Anthropic)**, an AI coding assistant. It was used for domain research, design discussion, writing code and tests, and drafting this README. All design decisions and outputs were reviewed by the author.
