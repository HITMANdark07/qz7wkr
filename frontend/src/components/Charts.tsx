import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Accuracy, DayView, fmtTime } from "../api";

// Colour goes on data: one hue (count-on), the forecast, the actual in ink; everything else neutral.
const C = { hue: "#15a35a", forecast: "#e07a1f", ink: "#15212a", neutral: "#b7c1c6", grid: "#e6ebea", bad: "#c2410c", muted: "#5d6b74" };
const AXIS = { fontSize: 12, stroke: C.muted, tickLine: false, axisLine: false } as const;
const toGw = (mw: number) => (mw / 1000).toFixed(1);
const gwTick = (v: number) => `${+(v / 1000).toFixed(1)}`;
const mwTip = (v: number) => `${Math.round(v).toLocaleString()} MW`;

const lastIndex = <T,>(rows: T[], key: keyof T) => {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return i;
  return -1;
};

/** Direct label at the end of a line instead of a legend. */
const endLabel = (text: string, color: string, idx: number, dy = 0) =>
  (props: { x?: number | string; y?: number | string; index?: number }) =>
    props.index === idx ? (
      <text x={Number(props.x) + 8} y={Number(props.y) + dy} dy={4} fill={color} fontSize={12} fontWeight={600}>{text}</text>
    ) : null;

export function DayChart({ day }: { day: DayView }) {
  // Actual = forecast - error, so the P10..P90 error range maps to [forecast - p90, forecast - p10].
  const data = day.series.map((p) => ({
    ...p,
    band: p.forecast == null ? null : [p.forecast - day.band.p90, p.forecast - day.band.p10],
  }));
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 12, right: 96, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="time" tickFormatter={fmtTime} interval={7} {...AXIS} />
        <YAxis tickFormatter={gwTick} {...AXIS} unit=" GW" width={64} />
        <Tooltip
          labelFormatter={(t) => `${fmtTime(t as string)} UK`}
          formatter={(v, name) => [Array.isArray(v) ? `${toGw(Number(v[0]))}–${toGw(Number(v[1]))} GW` : mwTip(Number(v)), name]}
        />
        <Area dataKey="band" name="Usual range" fill={C.forecast} fillOpacity={0.1} stroke="none" connectNulls />
        <Line dataKey="forecast" name="Forecast" stroke={C.forecast} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls>
          <LabelList content={endLabel("Forecast", C.forecast, lastIndex(data, "forecast"), -8)} />
        </Line>
        <Line dataKey="actual" name="Actual" stroke={C.ink} strokeWidth={2} dot={false} connectNulls>
          <LabelList content={endLabel("Actual", C.ink, lastIndex(data, "actual"), 6)} />
        </Line>
        <Line dataKey="dependable" name={`Count on (${day.confidence}%)`} stroke={C.hue} strokeWidth={3} dot={false} connectNulls>
          <LabelList content={endLabel(`Count on ${day.confidence}%`, C.hue, lastIndex(data, "dependable"))} />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function HorizonChart({ acc }: { acc: Accuracy }) {
  // Gate closure at 11:00 D-1 covers delivery 13-37h later: only those bars carry colour.
  const inWindow = (h: number) => h >= 13 && h <= 37;
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={acc.by_horizon} margin={{ top: 8, right: 8, left: -8, bottom: 14 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="horizon_h" interval={5} {...AXIS}
          label={{ value: "hours between forecast and delivery", position: "insideBottom", offset: -10, fontSize: 12, fill: C.muted }} />
        <YAxis tickFormatter={(v) => toGw(v)} {...AXIS} unit=" GW" width={64} />
        <Tooltip labelFormatter={(h) => `${h}h ahead`} formatter={(v) => [mwTip(v as number), "MAE"]} />
        <Bar dataKey="mae" radius={[2, 2, 0, 0]}>
          {acc.by_horizon.map((r) => <Cell key={r.horizon_h} fill={inWindow(r.horizon_h) ? C.forecast : C.neutral} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HourChart({ acc }: { acc: Accuracy }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={acc.by_hour} margin={{ top: 8, right: 8, left: -8, bottom: 14 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} interval={3} {...AXIS} />
        <YAxis tickFormatter={(v) => toGw(v)} {...AXIS} unit=" GW" width={64} />
        <Tooltip labelFormatter={(h) => `${String(h).padStart(2, "0")}:00 UK`} formatter={(v, n) => [mwTip(v as number), n]} />
        <ReferenceLine y={0} stroke={C.muted} />
        <Bar dataKey="mae" name="MAE" fill={C.neutral} radius={[2, 2, 0, 0]} />
        <Line dataKey="bias" name="Bias" stroke={C.forecast} strokeWidth={2} dot={false} />
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
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 20, right: 8, left: -8, bottom: 14 }} barCategoryGap={1}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="mid" type="number" domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={gwTick} {...AXIS}
          label={{ value: "forecast − actual (GW)", position: "insideBottom", offset: -10, fontSize: 12, fill: C.muted }} />
        <YAxis {...AXIS} width={64} unit=" h" />
        <Tooltip labelFormatter={(m) => `${toGw((m as number) - 250)} to ${toGw((m as number) + 250)} GW`} formatter={(v) => [`${v} hours`, "Count"]} />
        <Bar dataKey="count">
          {data.map((b) => <Cell key={b.from} fill={b.from >= 0 ? C.forecast : C.neutral} fillOpacity={b.from >= 0 ? 0.75 : 1} />)}
        </Bar>
        <ReferenceLine x={p10} stroke={C.muted} strokeDasharray="4 3" label={{ value: "P10", position: "top", fontSize: 11, fill: C.muted }} />
        <ReferenceLine x={p50} stroke={C.muted} label={{ value: "P50", position: "top", fontSize: 11, fill: C.muted }} />
        <ReferenceLine x={p90} stroke={C.bad} strokeWidth={2} label={{ value: "P90", position: "top", fontSize: 11, fill: C.bad }} />
      </BarChart>
    </ResponsiveContainer>
  );
}
