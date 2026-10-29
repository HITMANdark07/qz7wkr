from datetime import date
from functools import lru_cache
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import analytics as an

app = FastAPI(title="UK Wind Forecast Monitor API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

Mode = Literal["dayahead", "horizon"]
CONFIDENCE_LEVELS = (50, 80, 90, 95)


@lru_cache
def dataset() -> an.Dataset:
    return an.Dataset.load()


@lru_cache
def horizon_curve() -> list[dict]:
    return an.by_horizon(dataset())


@lru_cache
def accuracy_cached(mode: str, horizon: int) -> dict:
    ps = an.pairs(dataset(), mode, horizon)
    return {
        "mode": mode,
        "horizon_h": horizon if mode == "horizon" else None,
        "overall": an.metrics(ps),
        "by_hour": an.by_hour(ps),
        "histogram": an.histogram(ps),
        "by_horizon": horizon_curve(),
    }


@lru_cache
def buffers_cached(mode: str, horizon: int, confidence: int) -> dict[int, float]:
    return an.hourly_buffers(an.pairs(dataset(), mode, horizon), confidence)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/meta")
def meta():
    ds = dataset()
    pubs = {p for runs in ds.forecasts.values() for p in runs[0]}
    return {
        "first_delivery_day": an.FIRST_DELIVERY_DAY.isoformat(),
        "last_delivery_day": an.LAST_DELIVERY_DAY.isoformat(),
        "gate_closure_local": an.GATE_CLOSURE.strftime("%H:%M"),
        "max_horizon_h": an.MAX_HORIZON_H,
        "actual_points": len(ds.actuals),
        "forecast_runs": len(pubs),
        "source": "Elexon BMRS: FUELHH (fuelType=WIND), WINDFOR",
    }


@app.get("/api/accuracy")
def accuracy(mode: Mode = "dayahead", horizon: int = Query(24, ge=1, le=an.MAX_HORIZON_H)):
    return accuracy_cached(mode, horizon)


@app.get("/api/day")
def day(
    day: date = Query(..., alias="date"),
    mode: Mode = "dayahead",
    horizon: int = Query(24, ge=1, le=an.MAX_HORIZON_H),
    confidence: int = 90,
):
    if not an.FIRST_DELIVERY_DAY <= day <= an.LAST_DELIVERY_DAY:
        raise HTTPException(400, f"date must be between {an.FIRST_DELIVERY_DAY} and {an.LAST_DELIVERY_DAY}")
    if confidence not in CONFIDENCE_LEVELS:
        raise HTTPException(400, f"confidence must be one of {CONFIDENCE_LEVELS}")
    ds = dataset()
    buffers = buffers_cached(mode, horizon, confidence)
    series, fc_values, dep_values, publishes = [], [], [], set()
    for st in an.delivery_slots(day):
        fc = ds.latest_forecast(st, an.cutoff_for(st, mode, horizon))
        dependable = None
        if fc:
            fc_values.append(fc[1])
            publishes.add(fc[0])
            buf = buffers.get(st.astimezone(an.UK).hour)
            if buf is not None:
                dependable = max(fc[1] - buf, 0.0)
                dep_values.append(dependable)
        series.append({
            "time": st.isoformat(),
            "actual": ds.actuals.get(st),
            "forecast": fc[1] if fc else None,
            "dependable": dependable,
            "publish_time": fc[0].isoformat() if fc else None,
        })
    month = accuracy_cached(mode, horizon)["overall"]
    return {
        "date": day.isoformat(),
        "mode": mode,
        "cutoff": an.day_ahead_cutoff(day).isoformat() if mode == "dayahead" else None,
        "forecast_publish_times": sorted(p.isoformat() for p in publishes),
        "series": series,
        "summary": {
            # forecasts are hourly MW, so each point is that many MWh
            "forecast_energy_mwh": sum(fc_values),
            "forecast_peak_mw": max(fc_values, default=None),
            "forecast_min_mw": min(fc_values, default=None),
            "dependable_energy_mwh": sum(dep_values),
        },
        "confidence": confidence,
        "day_metrics": an.metrics(an.pairs(ds, mode, horizon, [day])),
        "band": {"p10": month.get("p10"), "p90": month.get("p90")},
    }
