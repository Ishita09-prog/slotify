"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Prediction, Zone } from "@/lib/types";
import { formatINR } from "@/lib/utils";

const axis = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const grid = { stroke: "hsl(var(--border))", strokeDasharray: "3 4", vertical: false } as const;

const tooltipStyle = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 10,
    fontSize: 12,
    color: "hsl(var(--popover-foreground))",
    boxShadow: "0 10px 30px -12px rgb(0 0 0 / .35)",
  },
  labelStyle: { fontWeight: 700, marginBottom: 4 },
  cursor: { fill: "hsl(var(--secondary) / .6)", stroke: "hsl(var(--border))" },
};

const legendStyle = { fontSize: 12, paddingTop: 8 };

export function OccupancyTrendChart({ data }: { data: { hour: string; today: number | null; yesterday: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="occToday" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...grid} />
        <XAxis dataKey="hour" {...axis} interval={3} />
        <YAxis {...axis} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
        <Legend wrapperStyle={legendStyle} iconType="circle" />
        <Area type="monotone" dataKey="yesterday" name="Yesterday" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" fill="none" strokeWidth={1.5} />
        <Area type="monotone" dataKey="today" name="Today" stroke="hsl(var(--primary))" fill="url(#occToday)" strokeWidth={2.5} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RevenueChart({ data }: { data: { day: string; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="day" {...axis} />
        <YAxis {...axis} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [formatINR(v), "Revenue"]} />
        <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={d.day} fill={i === data.length - 1 ? "hsl(var(--accent))" : "hsl(var(--primary) / .75)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PeakHoursChart({ data }: { data: { hour: string; vehicles: number }[] }) {
  const max = Math.max(...data.map((d) => d.vehicles), 1);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="hour" {...axis} interval={3} />
        <YAxis {...axis} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} vehicles`, "Entries"]} />
        <Bar dataKey="vehicles" radius={[4, 4, 0, 0]}>
          {data.map((d) => {
            const r = d.vehicles / max;
            const fill = r > 0.8 ? "hsl(var(--status-occupied))" : r > 0.55 ? "hsl(var(--status-reserved))" : "hsl(var(--status-available) / .8)";
            return <Cell key={d.hour} fill={fill} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PredictionChart({ trend, arrivalLabel, nowLabel }: { trend: Prediction["trend"]; arrivalLabel: string; nowLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={trend} margin={{ top: 16, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="hour" {...axis} interval={2} />
        <YAxis {...axis} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tooltipStyle} formatter={(v: number | number[]) => (Array.isArray(v) ? `${v[0]}–${v[1]}%` : `${v}%`)} />
        <Legend wrapperStyle={legendStyle} iconType="plainline" />
        <ReferenceLine x={nowLabel} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" label={{ value: "Now", fill: "hsl(var(--muted-foreground))", fontSize: 11, position: "top" }} />
        {arrivalLabel !== nowLabel && (
          <ReferenceLine x={arrivalLabel} stroke="hsl(var(--accent))" strokeWidth={2} label={{ value: "Arrival", fill: "hsl(var(--accent))", fontSize: 11, position: "top" }} />
        )}
        <Line type="monotone" dataKey="typical" name="Typical day" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
        <Line type="monotone" dataKey="actual" name="Today so far" stroke="hsl(var(--primary))" dot={false} strokeWidth={2.5} connectNulls={false} />
        <Area type="monotone" dataKey="band" name="80% interval" stroke="none" fill="hsl(var(--accent))" fillOpacity={0.18} connectNulls={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="forecast" name="AI forecast" stroke="hsl(var(--accent))" dot={false} strokeWidth={2.5} strokeDasharray="6 3" connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const DEMAND_FILL: Record<Zone["demand"], string> = {
  high: "hsl(var(--status-occupied))",
  medium: "hsl(var(--status-reserved))",
  low: "hsl(var(--status-available))",
};

export function ZoneOccupancyChart({ zones }: { zones: Zone[] }) {
  const data = [...zones].sort((a, b) => b.occupancy - a.occupancy).map((z) => ({ ...z, pct: Math.round(z.occupancy * 100) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid {...grid} horizontal={false} vertical />
        <XAxis type="number" {...axis} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="name" {...axis} width={130} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, "Parking occupancy"]} />
        <Bar dataKey="pct" radius={[0, 6, 6, 0]} barSize={18}>
          {data.map((z) => <Cell key={z.id} fill={DEMAND_FILL[z.demand]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CongestionHourlyChart({ data }: { data: { hour: string; index: number; searching: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="cong" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--status-occupied))" stopOpacity={0.5} />
            <stop offset="100%" stopColor="hsl(var(--status-occupied))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...grid} />
        <XAxis dataKey="hour" {...axis} interval={3} />
        <YAxis {...axis} domain={[0, 100]} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={legendStyle} iconType="circle" />
        <Area type="monotone" dataKey="index" name="Congestion index" stroke="hsl(var(--status-occupied))" fill="url(#cong)" strokeWidth={2} />
        <Area type="monotone" dataKey="searching" name="Cars circling for parking (%)" stroke="hsl(var(--primary))" fill="none" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
