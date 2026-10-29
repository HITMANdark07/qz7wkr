from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_meta():
    r = client.get("/api/meta")
    assert r.status_code == 200
    assert r.json()["first_delivery_day"] == "2026-01-02"


def test_day_ahead_view_uses_only_forecasts_before_gate():
    r = client.get("/api/day", params={"date": "2026-01-15"})
    body = r.json()
    assert r.status_code == 200
    assert len(body["series"]) == 48
    assert all(p <= body["cutoff"] for p in body["forecast_publish_times"])
    assert body["summary"]["forecast_energy_mwh"] > 0


def test_day_out_of_range_is_rejected():
    assert client.get("/api/day", params={"date": "2025-12-01"}).status_code == 400


def test_accuracy_shapes():
    body = client.get("/api/accuracy", params={"mode": "horizon", "horizon": 12}).json()
    assert body["overall"]["count"] > 500
    assert len(body["by_hour"]) == 24
    assert len(body["by_horizon"]) == 48


def test_dependable_wind_never_exceeds_forecast_at_high_confidence():
    body = client.get("/api/day", params={"date": "2026-01-20", "confidence": 95}).json()
    pts = [p for p in body["series"] if p["dependable"] is not None]
    assert pts and all(p["dependable"] <= p["forecast"] for p in pts)
