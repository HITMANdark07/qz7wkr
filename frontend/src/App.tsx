import { useEffect, useState } from "react";
import { Accuracy, api, DayView, fmtDateTime, gw, Meta, Mode, signedGw } from "./api";
import { DayChart, ErrorHistogram, HorizonChart, HourChart } from "./components/Charts";
import { PlanTable } from "./components/PlanTable";
import { PopNumber, Segmented } from "./components/Motion";

const HORIZON_DEBOUNCE_MS = 300;

function Mark() {
  // Product mark: a three-blade rotor in the data hue.
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="6" fill="var(--ink)" />
      {[0, 120, 240].map((a) => (
        <path key={a} d="M14 14 L12.6 4.5 Q14 3 15.4 4.5 Z" fill="var(--hue)" transform={`rotate(${a} 14 14)`} />
      ))}
      <circle cx="14" cy="14" r="1.8" fill="#fff" />
    </svg>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "bad" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? " " + tone : ""}`}><PopNumber value={value} /></div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

export default function App() {
  const [meta, setMeta] = useState<Meta>();
  const [date, setDate] = useState("2026-01-15");
  const [mode, setMode] = useState<Mode>("dayahead");
  const [horizon, setHorizon] = useState(24);
  // Slider position updates instantly; the data request waits until dragging pauses.
  const [horizonInput, setHorizonInput] = useState(24);
  useEffect(() => {
    const t = setTimeout(() => setHorizon(horizonInput), HORIZON_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [horizonInput]);
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
  const forecastGwh = day ? day.summary.forecast_energy_mwh / 1000 : 0;
  const countOnGwh = day ? day.summary.dependable_energy_mwh / 1000 : 0;
  const longDate = new Date(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <header className="bar">
        <div className="brand">
          <Mark />
          <div>
            <div className="brand-name">Wind Forecast Monitor</div>
            <div className="brand-scope">GB national wind · day-ahead desk · Jan 2026 pilot</div>
          </div>
        </div>
        <div className="controls">
          <label className="field">
            <span>Delivery day</span>
            <input id="date" type="date" value={date} min={meta?.first_delivery_day} max={meta?.last_delivery_day}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <div className="field">
            <span>Forecast used</span>
            <Segmented label="Forecast used" value={mode} onChange={setMode}
              options={[{ value: "dayahead", label: "At gate closure" }, { value: "horizon", label: "Fixed horizon" }]} />
          </div>
          {mode === "horizon" && (
            <label className="field">
              <span>{horizonInput}h ahead</span>
              <input id="horizon" type="range" min={1} max={meta?.max_horizon_h ?? 48} value={horizonInput}
                onChange={(e) => setHorizonInput(Number(e.target.value))} />
            </label>
          )}
          <div className="field">
            <span>Confidence</span>
            <Segmented label="Confidence level" value={confidence} onChange={setConfidence}
              options={[50, 80, 90, 95].map((c) => ({ value: c, label: `${c}%` }))} />
          </div>
        </div>
      </header>

      <main className="page">
        {error && <div className="error">Could not load data: {error}. Check that the API is running.</div>}

        {day && m && acc && (
          <>
            <section className="lead t-reveal">
              <div className="answer">
                <div className="eyebrow">{longDate} · wind you can count on</div>
                <div className="answer-figure">
                  <PopNumber value={countOnGwh.toFixed(0)} /><span className="unit"> GWh</span>
                </div>
                <div className="answer-of">of {forecastGwh.toFixed(0)} GWh forecast</div>
                <div className="gauge" aria-hidden="true">
                  <div className="gauge-fill" style={{ width: `${(countOnGwh / forecastGwh) * 100}%` }} />
                </div>
                <p className="answer-text">
                  In {confidence}% of January hours, actual wind met or beat this level. Buy the remaining demand on the
                  day-ahead market.
                </p>
                <dl className="facts">
                  <div><dt>Gate closure</dt><dd>{day.cutoff ? fmtDateTime(day.cutoff) : `${horizon}h before each hour`}</dd></div>
                  <div><dt>Forecast run</dt><dd>{day.forecast_publish_times.map(fmtDateTime).join(", ") || "–"}</dd></div>
                  <div><dt>Peak / low</dt><dd>{gw(day.summary.forecast_peak_mw)} / {gw(day.summary.forecast_min_mw)}</dd></div>
                </dl>
              </div>
              <div className="panel chart-panel">
                <div className="panel-head">
                  <h2>Forecast, actual and count-on level</h2>
                  <span className="muted">This day: off by {gw(day.day_metrics.mae)} on average</span>
                </div>
                <DayChart day={day} />
              </div>
            </section>

            <section className="stats">
              <Stat label="Typical miss (MAE)" value={gw(m.mae)} note={`${m.nmae_pct?.toFixed(0)}% of mean output`} />
              <Stat label="Bias" value={signedGw(m.bias)} tone={m.bias > 0 ? "bad" : undefined}
                note={m.bias > 0 ? "Forecast runs high" : "Forecast runs low"} />
              <Stat label="Shortfall at P90" value={gw(Math.max(m.p90, 0))} note="Buffer that covers 9 hours in 10" />
              <Stat label="Big misses (RMSE)" value={gw(m.rmse)} note="Weights large errors more" />
              <Stat label="Hours checked" value={String(m.count)} note={`Forecasts ${m.mean_horizon_h.toFixed(0)}h old on average`} />
            </section>

            <PlanTable day={day} />

            <h2 className="section-title">How far the forecast can be trusted <span className="muted">· all of January 2026</span></h2>
            <section className="grid">
              <div className="panel">
                <h3>Miss by forecast age</h3>
                <p className="muted small">Average miss by hours between publication and delivery. Buying at gate closure means the highlighted range.</p>
                <HorizonChart acc={acc} />
              </div>
              <div className="panel">
                <h3>Miss by hour of day</h3>
                <p className="muted small">Bars: size of the miss. Line: bias, above zero means too much wind was promised.</p>
                <HourChart acc={acc} />
              </div>
              <div className="panel">
                <h3>Spread of errors</h3>
                <p className="muted small">Hours by forecast − actual. Right of zero is a shortfall.</p>
                <ErrorHistogram acc={acc} />
              </div>
              <div className="panel">
                <h3>Error percentiles</h3>
                <table className="stats-table">
                  <tbody>
                    <tr><td>P10: more wind than forecast</td><td>{gw(m.p10, 2)}</td></tr>
                    <tr><td>P50: the typical hour</td><td>{gw(m.p50, 2)}</td></tr>
                    <tr><td>P90: shortfall buffer</td><td>{gw(m.p90, 2)}</td></tr>
                    <tr><td>Mean absolute error</td><td>{gw(m.mae, 2)}</td></tr>
                    <tr><td>Root mean square error</td><td>{gw(m.rmse, 2)}</td></tr>
                    <tr><td>Normalised MAE</td><td>{m.nmae_pct?.toFixed(1)}%</td></tr>
                  </tbody>
                </table>
                <p className="muted small">Error = forecast − actual.</p>
              </div>
            </section>
          </>
        )}

        <footer className="foot">
          <span>Wind Forecast Monitor</span>
          <span className="muted">
            Source: {meta?.source ?? "Elexon BMRS"} · {meta?.forecast_runs} forecast runs · {meta?.actual_points} half-hourly
            actuals · delivery {meta?.first_delivery_day} to {meta?.last_delivery_day}
          </span>
        </footer>
      </main>
    </>
  );
}
