import { useEffect, useState } from "react";
import { Accuracy, api, DayView, fmtDateTime, gw, Meta, Mode, signedGw } from "./api";
import { DayChart, ErrorHistogram, HorizonChart, HourChart } from "./components/Charts";
import { PlanTable } from "./components/PlanTable";

function Tile({ label, value, note, highlight }: { label: string; value: string; note: string; highlight?: boolean }) {
  return (
    <div className={`tile${highlight ? " tile-key" : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-note">{note}</div>
    </div>
  );
}

export default function App() {
  const [meta, setMeta] = useState<Meta>();
  const [date, setDate] = useState("2026-01-15");
  const [mode, setMode] = useState<Mode>("dayahead");
  const [horizon, setHorizon] = useState(24);
  const [confidence, setConfidence] = useState(90);
  const [day, setDay] = useState<DayView>();
  const [acc, setAcc] = useState<Accuracy>();
  const [error, setError] = useState<string>();

  useEffect(() => { api.meta().then(setMeta).catch((e) => setError(e.message)); }, []);

  useEffect(() => {
    setError(undefined);
    Promise.all([api.day(date, mode, horizon, confidence), api.accuracy(mode, horizon)])
      .then(([d, a]) => { setDay(d); setAcc(a); })
      .catch((e) => setError(e.message));
  }, [date, mode, horizon, confidence]);

  const m = acc?.overall;
  const decisionLabel = mode === "dayahead"
    ? `Latest forecast published before ${meta?.gate_closure_local ?? "11:00"} UK on the day before delivery`
    : `Latest forecast published at least ${horizon}h before each hour`;

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="eyebrow">Day-ahead trading desk · GB national wind</div>
          <h1>Wind Forecast Monitor</h1>
        </div>
        <div className="controls">
          <label>
            <span>Delivery day</span>
            <input id="date" type="date" value={date} min={meta?.first_delivery_day} max={meta?.last_delivery_day}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <div className="seg" role="group" aria-label="Decision rule">
            <button className={mode === "dayahead" ? "on" : ""} onClick={() => setMode("dayahead")}>Day-ahead (D-1 11:00)</button>
            <button className={mode === "horizon" ? "on" : ""} onClick={() => setMode("horizon")}>Fixed horizon</button>
          </div>
          <div className="seg" role="group" aria-label="Confidence level">
            {[50, 80, 90, 95].map((c) => (
              <button key={c} className={confidence === c ? "on" : ""} onClick={() => setConfidence(c)}>{c}%</button>
            ))}
          </div>
          {mode === "horizon" && (
            <label>
              <span>Horizon: {horizon}h</span>
              <input id="horizon" type="range" min={1} max={meta?.max_horizon_h ?? 48} value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))} />
            </label>
          )}
        </div>
      </header>

      {error && <div className="error">Could not load data: {error}. Check that the API is running.</div>}

      {day && m && acc && (
        <>
          <p className="rule">
            <b>Decision rule:</b> {decisionLabel}.
            {day.cutoff && <> Gate closure for {date}: <b>{fmtDateTime(day.cutoff)}</b>.</>}
            {day.forecast_publish_times.length > 0 && (
              <> Forecast run used: <b>{day.forecast_publish_times.map(fmtDateTime).join(", ")}</b>.</>
            )}
          </p>

          <section className="tiles">
            <Tile label="Forecast wind energy" value={`${(day.summary.forecast_energy_mwh / 1000).toFixed(0)} GWh`}
              note="Expected over the delivery day" />
            <Tile label="Peak / low" value={`${((day.summary.forecast_peak_mw ?? 0) / 1000).toFixed(1)} / ${gw(day.summary.forecast_min_mw)}`}
              note="Windiest and calmest forecast hour" />
            <Tile label="Typical miss (MAE)" value={gw(m.mae)}
              note={`January average · ${m.nmae_pct?.toFixed(0)}% of mean output`} />
            <Tile label="Bias" value={signedGw(m.bias)}
              note={m.bias > 0 ? "Forecast runs high: expect less wind than shown" : "Forecast runs low: expect more wind than shown"} />
            <Tile highlight label={`Wind you can count on (${confidence}%)`}
              value={`${(day.summary.dependable_energy_mwh / 1000).toFixed(0)} GWh`}
              note={`Actual wind met or beat this in ${confidence}% of January hours. Buy the rest elsewhere`} />
            <Tile label="Planning buffer (P90)" value={gw(Math.max(m.p90, 0))}
              note="In 9 of 10 hours, wind fell short of forecast by no more than this" />
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Forecast vs actual · {new Date(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
              <span className="muted">
                On this day: MAE {gw(day.day_metrics.mae)}, bias {day.day_metrics.count ? signedGw(day.day_metrics.bias) : "–"}
              </span>
            </div>
            <DayChart day={day} />
            <p className="muted small">Shaded band: where actual wind landed 80% of the time in January, given this forecast. Times in UK local time.</p>
          </section>

          <PlanTable day={day} />

          <h2 className="section-title">How far can the forecast be trusted? · all of January 2026</h2>
          <section className="grid">
            <div className="card">
              <h3>Accuracy by forecast horizon</h3>
              <p className="muted small">Average miss (MAE) by how many hours ahead the forecast was published. Day-ahead buying is stuck in the shaded window.</p>
              <HorizonChart acc={acc} />
            </div>
            <div className="card">
              <h3>Error by hour of day</h3>
              <p className="muted small">Which delivery hours the forecast handles worst. Bars show the size of the miss, the line shows its direction.</p>
              <HourChart acc={acc} />
            </div>
            <div className="card">
              <h3>Error distribution</h3>
              <p className="muted small">Hours by forecast error. Right of zero means less wind arrived than forecast.</p>
              <ErrorHistogram acc={acc} />
            </div>
            <div className="card">
              <h3>Summary statistics</h3>
              <table className="stats">
                <tbody>
                  <tr><td>Hours compared</td><td>{m.count}</td></tr>
                  <tr><td>MAE: average size of miss</td><td>{gw(m.mae, 2)}</td></tr>
                  <tr><td>RMSE: penalises big misses</td><td>{gw(m.rmse, 2)}</td></tr>
                  <tr><td>Bias: average signed error</td><td>{signedGw(m.bias)}</td></tr>
                  <tr><td>P10 / P50 / P90 error</td><td>{gw(m.p10)} / {gw(m.p50)} / {gw(m.p90)}</td></tr>
                  <tr><td>Normalised MAE</td><td>{m.nmae_pct?.toFixed(1)}%</td></tr>
                  <tr><td>Average forecast age</td><td>{m.mean_horizon_h.toFixed(1)} h</td></tr>
                </tbody>
              </table>
              <p className="muted small">Error = forecast − actual. Positive means the forecast promised more wind than arrived.</p>
            </div>
          </section>
        </>
      )}

      <footer className="muted small">
        Data: {meta?.source ?? "Elexon BMRS"} · {meta?.forecast_runs} forecast runs, {meta?.actual_points} half-hourly actuals.
        Delivery days {meta?.first_delivery_day} to {meta?.last_delivery_day} (purchase decisions made in January 2026).
      </footer>
    </div>
  );
}
