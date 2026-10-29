import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Accuracy, DayView, fmtTime } from "../api";

const C = { truth: "#1e293b", dependable: "#16a34a", actual: "#1f7a8c", forecast: "#e07a1f", band: "#e07a1f", bias: "#7a4fa3", grid: "#e3e8ec" };
const toGw = (mw: number) => (mw / 1000).toFixed(1);
const gwTick = (v: number) => `${+(v / 1000).toFixed(1)}`;
const mwTip = (v: number) => `${Math.round(v).toLocaleString()} MW`;

export function DayChart({ day }: { day: DayView }) {
  // Actual = forecast - error, so the P10..P90 error range maps to [forecast - p90, forecast - p10].
  const data = day.series.map((p) => ({
    ...p,
    band: p.forecast == null ? null : [p.forecast - day.band.p90, p.forecast - day.band.p10],
  }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="time" tickFormatter={fmtTime} interval={5} fontSize={12} />
        <YAxis tickFormatter={gwTick} fontSize={12} label={{ value: "GW", angle: -90, position: "insideLeft", fontSize: 12 }} />
        <Tooltip
          labelFormatter={(t) => `${fmtTime(t as string)} UK`}
          formatter={(v) => (Array.isArray(v) ? `${toGw(Number(v[0]))}–${toGw(Number(v[1]))} GW` : mwTip(Number(v)))}
        />
        <Legend />
        <Area dataKey="band" name="Likely range (P10–P90)" fill={C.band} fillOpacity={0.15} stroke="none" connectNulls />
        <Line dataKey="actual" name="Actual wind" stroke={C.truth} strokeWidth={2.5} dot={false} connectNulls />
        <Line dataKey="forecast" name="Forecast at decision time" stroke={C.forecast} strokeWidth={2.5}
          strokeDasharray="6 4" dot={false} connectNulls />
        <Line dataKey="dependable" name={`Wind you can count on (${day.confidence}%)`} stroke={C.dependable}
          strokeWidth={2.5} dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function HorizonChart({ acc }: { acc: Accuracy }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={acc.by_horizon} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="horizon_h" fontSize={12} interval={5}
          label={{ value: "hours ahead the forecast was published", position: "insideBottom", offset: -6, fontSize: 12 }} />
        <YAxis tickFormatter={(v) => toGw(v)} fontSize={12} />
        <Tooltip labelFormatter={(h) => `${h}h ahead`} formatter={(v) => mwTip(v as number)} />
        {/* Day-ahead purchases at 11:00 D-1 rely on forecasts 13–37h before delivery. */}
        <ReferenceArea x1={13} x2={37} fill={C.forecast} fillOpacity={0.08} label={{ value: "day-ahead window", fontSize: 11, position: "insideTop" }} />
        <Bar dataKey="mae" name="MAE" fill={C.actual} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HourChart({ acc }: { acc: Accuracy }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={acc.by_hour} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} fontSize={12} interval={2} />
        <YAxis tickFormatter={(v) => toGw(v)} fontSize={12} />
        <Tooltip labelFormatter={(h) => `${String(h).padStart(2, "0")}:00 UK`} formatter={(v) => mwTip(v as number)} />
        <Legend />
        <ReferenceLine y={0} stroke="#999" />
        <Bar dataKey="mae" name="MAE (size of miss)" fill={C.actual} />
        <Line dataKey="bias" name="Bias (+ = over-forecast)" stroke={C.bias} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ErrorHistogram({ acc }: { acc: Accuracy }) {
  const { p10, p50, p90 } = acc.overall;
  const data = acc.histogram.map((b) => ({ ...b, mid: (b.from + b.to) / 2 }));
  const lo = Math.floor((data[0]?.from ?? 0) / 2000) * 2000;
  const ticks = Array.from({ length: Math.ceil(((data[data.length - 1]?.to ?? 0) - lo) / 2000) + 1 }, (_, i) => lo + i * 2000);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 20, right: 16, left: 0, bottom: 10 }} barCategoryGap={1}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="mid" type="number" domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={gwTick} fontSize={12}
          label={{ value: "forecast − actual (GW)", position: "insideBottom", offset: -6, fontSize: 12 }} />
        <YAxis fontSize={12} />
        <Tooltip labelFormatter={(m) => `${toGw((m as number) - 250)} to ${toGw((m as number) + 250)} GW`} formatter={(v) => `${v} hours`} />
        <Bar dataKey="count" name="hours" fill={C.actual} />
        <ReferenceLine x={p10} stroke={C.bias} strokeDasharray="4 3" label={{ value: "P10", position: "top", fontSize: 11 }} />
        <ReferenceLine x={p50} stroke={C.bias} label={{ value: "P50", position: "top", fontSize: 11 }} />
        <ReferenceLine x={p90} stroke={C.forecast} strokeWidth={2} label={{ value: "P90", position: "top", fontSize: 11 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}
