"""Core domain logic: pick the forecast available at decision time and measure its error.

Error convention: error = forecast - actual (MW).
  positive -> forecast too high -> less wind than planned -> shortfall risk.
"""
import csv
import gzip
import math
from bisect import bisect_right
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

UK = ZoneInfo("Europe/London")
DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# Purchase decisions made 1-31 Jan 2026 -> delivery days 2 Jan .. 1 Feb 2026.
FIRST_DELIVERY_DAY = date(2026, 1, 2)
LAST_DELIVERY_DAY = date(2026, 2, 1)
GATE_CLOSURE = time(11, 0)  # GB day-ahead auction gate, D-1 local time
MAX_HORIZON_H = 48


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


@dataclass
class Dataset:
    actuals: dict[datetime, float]
    # startTime -> (publishTimes sorted ascending, matching generation values)
    forecasts: dict[datetime, tuple[list[datetime], list[float]]]

    @classmethod
    def from_rows(cls, actual_rows, forecast_rows) -> "Dataset":
        actuals = {_ts(st): float(g) for st, g in actual_rows}
        grouped: dict[datetime, list[tuple[datetime, float]]] = {}
        for pub, st, g in forecast_rows:
            grouped.setdefault(_ts(st), []).append((_ts(pub), float(g)))
        forecasts = {}
        for st, runs in grouped.items():
            runs.sort()
            forecasts[st] = ([p for p, _ in runs], [g for _, g in runs])
        return cls(actuals, forecasts)

    @classmethod
    def load(cls, data_dir: Path = DATA_DIR) -> "Dataset":
        def read(name):
            with gzip.open(data_dir / name, "rt") as f:
                rows = csv.reader(f)
                next(rows)
                return list(rows)

        return cls.from_rows(read("actuals.csv.gz"), read("forecasts.csv.gz"))

    def latest_forecast(self, start: datetime, cutoff: datetime) -> tuple[datetime, float] | None:
        """Most recent forecast for `start` published at or before `cutoff`."""
        runs = self.forecasts.get(start)
        if not runs:
            return None
        i = bisect_right(runs[0], cutoff)
        return (runs[0][i - 1], runs[1][i - 1]) if i else None


# ---------- decision-time rules ----------

def day_ahead_cutoff(delivery_day: date) -> datetime:
    """11:00 UK time on the day before delivery, in UTC."""
    return datetime.combine(delivery_day - timedelta(days=1), GATE_CLOSURE, UK).astimezone(timezone.utc)


def cutoff_for(start: datetime, mode: str, horizon_h: int) -> datetime:
    if mode == "dayahead":
        return day_ahead_cutoff(start.astimezone(UK).date())
    return start - timedelta(hours=horizon_h)


def delivery_slots(day: date, step_min: int = 30) -> list[datetime]:
    """UTC start times of every slot in a UK-local delivery day (handles DST)."""
    start = datetime.combine(day, time(0), UK).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time(0), UK).astimezone(timezone.utc)
    out, t = [], start
    while t < end:
        out.append(t)
        t += timedelta(minutes=step_min)
    return out


def delivery_days() -> list[date]:
    n = (LAST_DELIVERY_DAY - FIRST_DELIVERY_DAY).days + 1
    return [FIRST_DELIVERY_DAY + timedelta(days=i) for i in range(n)]


# ---------- pairing forecasts with actuals ----------

@dataclass
class Pair:
    start: datetime
    publish: datetime
    forecast: float
    actual: float

    @property
    def error(self) -> float:
        return self.forecast - self.actual

    @property
    def horizon_h(self) -> float:
        return (self.start - self.publish).total_seconds() / 3600


def pairs(ds: Dataset, mode: str, horizon_h: int, days: list[date] | None = None) -> list[Pair]:
    """Forecast/actual pairs at every slot where both exist (forecasts are hourly)."""
    out = []
    for day in days or delivery_days():
        for st in delivery_slots(day):
            actual = ds.actuals.get(st)
            fc = ds.latest_forecast(st, cutoff_for(st, mode, horizon_h))
            if actual is not None and fc is not None:
                out.append(Pair(st, fc[0], fc[1], actual))
    return out


# ---------- metrics ----------

def percentile(values: list[float], q: float) -> float:
    """Linear-interpolated percentile, q in [0, 100]."""
    s = sorted(values)
    if not s:
        return math.nan
    k = (len(s) - 1) * q / 100
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def metrics(ps: list[Pair]) -> dict:
    if not ps:
        return {"count": 0}
    errs = [p.error for p in ps]
    n = len(errs)
    mae = sum(abs(e) for e in errs) / n
    mean_actual = sum(p.actual for p in ps) / n
    return {
        "count": n,
        "mae": mae,
        "rmse": math.sqrt(sum(e * e for e in errs) / n),
        "bias": sum(errs) / n,
        "p10": percentile(errs, 10),
        "p50": percentile(errs, 50),
        "p90": percentile(errs, 90),
        "nmae_pct": 100 * mae / mean_actual if mean_actual else None,
        "mean_horizon_h": sum(p.horizon_h for p in ps) / n,
    }


def by_hour(ps: list[Pair]) -> list[dict]:
    groups: dict[int, list[Pair]] = {}
    for p in ps:
        groups.setdefault(p.start.astimezone(UK).hour, []).append(p)
    return [{"hour": h, **metrics(groups[h])} for h in sorted(groups)]


def hourly_buffers(ps: list[Pair], confidence: int) -> dict[int, float]:
    """Per UK hour of day, the error at the given confidence level (e.g. 90 -> P90).

    dependable wind = forecast - buffer: actual wind met or beat it in `confidence`% of
    past hours. The buffer also absorbs systematic bias.
    """
    groups: dict[int, list[float]] = {}
    for p in ps:
        groups.setdefault(p.start.astimezone(UK).hour, []).append(p.error)
    return {h: percentile(errs, confidence) for h, errs in groups.items()}


def by_horizon(ds: Dataset, horizons=range(1, MAX_HORIZON_H + 1)) -> list[dict]:
    return [{"horizon_h": h, **metrics(pairs(ds, "horizon", h))} for h in horizons]


def histogram(ps: list[Pair], bin_mw: int = 500) -> list[dict]:
    counts: dict[int, int] = {}
    for p in ps:
        b = math.floor(p.error / bin_mw) * bin_mw
        counts[b] = counts.get(b, 0) + 1
    if not counts:
        return []
    return [{"from": b, "to": b + bin_mw, "count": counts.get(b, 0)}
            for b in range(min(counts), max(counts) + bin_mw, bin_mw)]
