"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell, Legend } from "recharts";

const axis = { stroke: "#64748b", fontSize: 10, tickLine: false, axisLine: false } as const;
const grid = { stroke: "#1e293b", strokeDasharray: "3 4", vertical: false } as const;
const tip = {
  contentStyle: { background: "#0b1220", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11, color: "#e2e8f0" },
  labelStyle: { fontWeight: 700, marginBottom: 2, color: "#e2e8f0" },
  cursor: { stroke: "#334155" },
};

export interface TrendPoint {
  label: string;
  observed?: number | null;
  forecast?: number | null;
  band?: [number, number] | null;
  counterfactual?: number | null;
}

/** Observed occupancy (camera history) + model forecast with 80% band. One y-axis (%). */
export function OccupancyForecastChart({ data, nowLabel, height = 220, markers = [] }: { data: TrendPoint[]; nowLabel?: string; height?: number; markers?: { label: string; text: string; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 14, right: 10, left: -22, bottom: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="label" {...axis} minTickGap={24} />
        <YAxis {...axis} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tip} formatter={(v: number | number[], name) => [Array.isArray(v) ? `${v[0]}–${v[1]}%` : `${v}%`, name]} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="plainline" />
        {nowLabel && <ReferenceLine x={nowLabel} stroke="#64748b" strokeDasharray="2 4" label={{ value: "Now", fill: "#94a3b8", fontSize: 10, position: "top" }} />}
        {markers.map((m) => (
          <ReferenceLine key={m.label + m.text} x={m.label} stroke={m.color} strokeWidth={1.5} label={{ value: m.text, fill: m.color, fontSize: 10, position: "insideTopLeft" }} />
        ))}
        <ReferenceLine y={95} stroke="#ef4444" strokeOpacity={0.35} strokeDasharray="4 4" />
        <Area type="monotone" dataKey="band" name="80% interval" stroke="none" fill="#38bdf8" fillOpacity={0.15} isAnimationActive={false} connectNulls={false} />
        <Line type="monotone" dataKey="observed" name="Observed (cameras)" stroke="#e2e8f0" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#38bdf8" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />
        {data.some((d) => d.counterfactual != null) && (
          <Line type="monotone" dataKey="counterfactual" name="Forecast without action" stroke="#f97316" strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} connectNulls />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Horizontal comparison bars (one measure). */
export function CompareBars({ data, unit = "", height = 160 }: { data: { name: string; value: number; highlight?: boolean }[]; unit?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 4, bottom: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" {...axis} width={128} />
        <Tooltip {...tip} cursor={{ fill: "#1e293b" }} formatter={(v: number) => `${v}${unit}`} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: "right", fill: "#cbd5e1", fontSize: 10, formatter: (v: number) => `${v}${unit}` }} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.highlight ? "#38bdf8" : "#475569"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizonChart({ data, height = 200 }: { data: { h: string; gbm: number; heuristic_v1: number; persistence: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="h" {...axis} />
        <YAxis {...axis} tickFormatter={(v) => `${v}`} />
        <Tooltip {...tip} formatter={(v: number) => `${v} pts`} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        <Line dataKey="gbm" name="Slotify GBM" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <Line dataKey="heuristic_v1" name="v1 heuristic (oracle curves)" stroke="#f97316" strokeWidth={1.5} dot={{ r: 3 }} isAnimationActive={false} />
        <Line dataKey="persistence" name="'Same as now'" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 3 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
