import { useState } from "react";
import { DayView, fmtTime } from "../api";

const mw = (v: number | null) => (v == null ? "–" : Math.round(v).toLocaleString("en-GB"));

/** Hourly plan for the delivery day: what to rely on from wind, ready to paste into a buying sheet. */
export function PlanTable({ day }: { day: DayView }) {
  const [copied, setCopied] = useState(false);
  const rows = day.series.filter((p) => p.forecast != null);

  const copy = async () => {
    const header = "time_uk,forecast_mw,safety_buffer_mw,dependable_wind_mw,actual_mw";
    const lines = rows.map((p) =>
      [fmtTime(p.time), p.forecast, p.forecast! - (p.dependable ?? p.forecast!), p.dependable, p.actual ?? ""]
        .map((v) => (typeof v === "number" ? Math.round(v) : v)).join(","));
    try {
      await navigator.clipboard.writeText([header, ...lines].join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Hourly buying plan · wind at {day.confidence}% confidence</h2>
        <button className="btn" onClick={copy}>{copied ? "Copied" : "Copy as CSV"}</button>
      </div>
      <p className="muted small">
        Dependable wind = forecast − safety buffer. The buffer for each hour of the day is the {day.confidence}th
        percentile of January's forecast errors at that hour, so it also corrects the forecast's tendency to run high.
        Buy (demand − dependable wind) from the day-ahead market.
      </p>
      <div className="table-wrap">
        <table className="plan">
          <thead>
            <tr><th>Hour (UK)</th><th>Forecast MW</th><th>Safety buffer MW</th><th>Count on MW</th><th>Actual MW</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.time}>
                <td>{fmtTime(p.time)}</td>
                <td>{mw(p.forecast)}</td>
                <td>{mw(p.forecast! - (p.dependable ?? p.forecast!))}</td>
                <td className="strong">{mw(p.dependable)}</td>
                <td className={p.actual != null && p.dependable != null && p.actual < p.dependable ? "short" : ""}>{mw(p.actual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Actual MW in red marks hours where wind fell below even the dependable level.</p>
    </section>
  );
}
