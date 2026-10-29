"""Download the Elexon BMRS data needed for January 2026 purchase decisions.

Writes two gzipped CSVs into backend/data/:
  actuals.csv.gz    startTime, generation             (FUELHH, fuelType=WIND, 30-min)
  forecasts.csv.gz  publishTime, startTime, generation (WINDFOR, hourly, every run)

Run once:  python backend/scripts/fetch_data.py
"""
import csv
import gzip
import json
import ssl
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# Decisions made 1-31 Jan 2026 -> delivery days 2 Jan - 1 Feb.
# Forecasts: published from 30 Dec (covers 48h horizons for 1 Jan) up to 1 Feb.
# Actuals: target times 1 Jan - 2 Feb (publishTime trails startTime by 30 min).
FORECAST_RANGE = (datetime(2025, 12, 30, tzinfo=timezone.utc), datetime(2026, 2, 2, tzinfo=timezone.utc))
ACTUAL_RANGE = (datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 2, 3, tzinfo=timezone.utc))
CHUNK = timedelta(days=5)


def _ssl_context():
    # python.org macOS builds ship without CA certs; use certifi when available.
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return None


def _get(url: str) -> list[dict]:
    with urllib.request.urlopen(url, timeout=60, context=_ssl_context()) as resp:
        return json.load(resp)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(dataset: str, start: datetime, end: datetime, extra: str = "") -> list[dict]:
    rows, cur = [], start
    while cur < end:
        nxt = min(cur + CHUNK, end)
        url = f"{BASE}/{dataset}/stream?publishDateTimeFrom={_iso(cur)}&publishDateTimeTo={_iso(nxt)}{extra}"
        batch = _get(url)
        print(f"{dataset} {cur:%Y-%m-%d} -> {nxt:%Y-%m-%d}: {len(batch)} rows")
        rows.extend(batch)
        cur = nxt
    return rows


def write_csv(path: Path, header: list[str], rows: list[tuple]) -> None:
    with gzip.open(path, "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"wrote {len(rows)} rows -> {path}")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Actuals: keep the latest publication for each settlement period.
    latest: dict[str, tuple[str, int]] = {}
    for r in fetch("FUELHH", *ACTUAL_RANGE, "&fuelType=WIND"):
        if r.get("fuelType") != "WIND":
            continue
        prev = latest.get(r["startTime"])
        if prev is None or r["publishTime"] > prev[0]:
            latest[r["startTime"]] = (r["publishTime"], r["generation"])
    actuals = sorted((st, gen) for st, (_, gen) in latest.items())
    write_csv(DATA_DIR / "actuals.csv.gz", ["startTime", "generation"], actuals)

    # Forecasts: keep every run (publishTime matters), drop exact duplicates.
    seen = {(r["publishTime"], r["startTime"]): r["generation"] for r in fetch("WINDFOR", *FORECAST_RANGE)}
    forecasts = sorted((p, s, g) for (p, s), g in seen.items())
    write_csv(DATA_DIR / "forecasts.csv.gz", ["publishTime", "startTime", "generation"], forecasts)


if __name__ == "__main__":
    main()
