from datetime import date, datetime, timezone

import pytest

from backend.app import analytics as an


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


@pytest.fixture
def ds():
    # Target 2026-01-10 12:00 has three forecast runs; actual = 9000.
    return an.Dataset.from_rows(
        actual_rows=[("2026-01-10T12:00:00Z", "9000"), ("2026-01-10T12:30:00Z", "9100")],
        forecast_rows=[
            ("2026-01-08T10:00:00Z", "2026-01-10T12:00:00Z", "8000"),
            ("2026-01-09T10:30:00Z", "2026-01-10T12:00:00Z", "10000"),
            ("2026-01-09T13:00:00Z", "2026-01-10T12:00:00Z", "9500"),  # after gate closure
        ],
    )


def test_day_ahead_cutoff_is_11am_uk_on_previous_day():
    assert an.day_ahead_cutoff(date(2026, 1, 10)) == utc(2026, 1, 9, 11)


def test_day_ahead_cutoff_respects_bst():
    # In summer UK time is UTC+1, so 11:00 local is 10:00 UTC.
    assert an.day_ahead_cutoff(date(2026, 7, 10)) == utc(2026, 7, 9, 10)


def test_latest_forecast_ignores_runs_published_after_cutoff(ds):
    pub, gen = ds.latest_forecast(utc(2026, 1, 10, 12), an.day_ahead_cutoff(date(2026, 1, 10)))
    assert pub == utc(2026, 1, 9, 10, 30) and gen == 10000


def test_horizon_mode_uses_start_minus_horizon(ds):
    # 30h before target = 2026-01-09 06:00 -> only the 8 Jan run qualifies.
    assert ds.latest_forecast(utc(2026, 1, 10, 12), an.cutoff_for(utc(2026, 1, 10, 12), "horizon", 30))[1] == 8000


def test_no_forecast_before_cutoff_returns_none(ds):
    assert ds.latest_forecast(utc(2026, 1, 10, 12), utc(2026, 1, 1)) is None


def test_pairs_only_where_both_exist(ds):
    ps = an.pairs(ds, "dayahead", 24, [date(2026, 1, 10)])
    assert len(ps) == 1  # 12:30 has an actual but no (hourly) forecast
    assert ps[0].error == 1000
    assert ps[0].horizon_h == pytest.approx(25.5)


def test_delivery_day_has_48_half_hours_in_winter():
    assert len(an.delivery_slots(date(2026, 1, 10))) == 48


def test_delivery_day_has_46_slots_on_spring_dst_change():
    assert len(an.delivery_slots(date(2026, 3, 29))) == 46


def test_metrics_on_worked_example():
    # The 5-hour example used in the demo video.
    fc = [10000, 9000, 8000, 7000, 6000]
    act = [9000, 9500, 6000, 7000, 6500]
    ps = [an.Pair(utc(2026, 1, 10, i), utc(2026, 1, 9), f, a) for i, (f, a) in enumerate(zip(fc, act))]
    m = an.metrics(ps)
    assert m["mae"] == 800
    assert m["bias"] == 400
    assert m["rmse"] == pytest.approx(1048.8, abs=0.1)
    assert m["nmae_pct"] == pytest.approx(10.526, abs=0.01)
    assert m["p50"] == 0


def test_percentile_interpolates():
    assert an.percentile([0, 10], 50) == 5
    assert an.percentile([1, 2, 3, 4, 5], 90) == pytest.approx(4.6)


def test_histogram_bins_are_contiguous():
    ps = [an.Pair(utc(2026, 1, 1), utc(2025, 12, 31), f, 0) for f in (-600, 100, 1200)]
    h = an.histogram(ps, 500)
    assert [b["from"] for b in h] == [-1000, -500, 0, 500, 1000]
    assert sum(b["count"] for b in h) == 3


def test_hourly_buffers_are_per_hour_percentiles():
    ps = [an.Pair(utc(2026, 1, d, 18), utc(2026, 1, d - 1), 1000 + e, 1000) for d, e in zip(range(2, 7), (0, 100, 200, 300, 400))]
    assert an.hourly_buffers(ps, 50) == {18: 200}
