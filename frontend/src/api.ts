export type Mode = "dayahead" | "horizon";

export interface Metrics {
  count: number;
  mae: number;
  rmse: number;
  bias: number;
  p10: number;
  p50: number;
  p90: number;
  nmae_pct: number | null;
  mean_horizon_h: number;
}

export interface Meta {
  first_delivery_day: string;
  last_delivery_day: string;
  gate_closure_local: string;
  max_horizon_h: number;
  actual_points: number;
  forecast_runs: number;
  source: string;
}

export interface DayPoint {
  time: string;
  actual: number | null;
  forecast: number | null;
  dependable: number | null;
  publish_time: string | null;
}

export interface DayView {
  date: string;
  mode: Mode;
  cutoff: string | null;
  forecast_publish_times: string[];
  series: DayPoint[];
  summary: { forecast_energy_mwh: number; forecast_peak_mw: number | null; forecast_min_mw: number | null; dependable_energy_mwh: number };
  confidence: number;
  day_metrics: Metrics;
  band: { p10: number; p90: number };
}

export interface Accuracy {
  mode: Mode;
  horizon_h: number | null;
  overall: Metrics;
  by_hour: ({ hour: number } & Metrics)[];
  by_horizon: ({ horizon_h: number } & Metrics)[];
  histogram: { from: number; to: number; count: number }[];
}

const BASE = import.meta.env.VITE_API_URL ?? "";

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}${path}?${qs}`);
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

export const api = {
  meta: () => get<Meta>("/api/meta"),
  day: (date: string, mode: Mode, horizon: number, confidence: number) =>
    get<DayView>("/api/day", { date, mode, horizon, confidence }),
  accuracy: (mode: Mode, horizon: number) => get<Accuracy>("/api/accuracy", { mode, horizon }),
};

// ---- formatting (UK local time, MW -> GW) ----
const ukTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const ukDateTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
});
export const fmtTime = (iso: string) => ukTime.format(new Date(iso));
export const fmtDateTime = (iso: string) => ukDateTime.format(new Date(iso));
export const gw = (mw: number | null | undefined, digits = 1) =>
  mw == null ? "–" : `${(mw / 1000).toFixed(digits)} GW`;
export const signedGw = (mw: number) => `${mw >= 0 ? "+" : "−"}${Math.abs(mw / 1000).toFixed(1)} GW`;
