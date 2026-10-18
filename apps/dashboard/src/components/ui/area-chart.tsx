import { useId } from "react";
import { cn } from "@/lib/utils";

export interface AreaChartProps {
  values: number[];
  max?: number;
  min?: number;
  className?: string;
  stroke?: string;
  height?: number;
  format?: (value: number) => string;
  label?: string;
  empty?: string;
}

const smooth = (points: [number, number][]) => {
  if (points.length < 2) return points.map(([x, y]) => `M${x},${y}`).join(" ");
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[Math.max(0, i - 1)]!, [x1, y1] = points[i]!, [x2, y2] = points[i + 1]!, [x3, y3] = points[Math.min(points.length - 1, i + 2)]!;
    const c1x = x1 + (x2 - x0) / 6, c1y = y1 + (y2 - y0) / 6, c2x = x2 - (x3 - x1) / 6, c2y = y2 - (y3 - y1) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${x2},${y2}`;
  }
  return d;
};

/** Dependency-free SVG area chart for short live series (CPU load, memory). */
export function AreaChart({ values, max, min = 0, className, stroke = "currentColor", height = 72, format = (v) => v.toFixed(1), label, empty = "Collecting samples…" }: AreaChartProps) {
  const id = useId();
  const width = 320;
  const top = Math.max(max ?? Math.max(...values, 1), 1e-9);
  const n = values.length;
  const points: [number, number][] = values.map((v, i) => [
    n === 1 ? width : (i / (n - 1)) * width,
    height - 4 - ((Math.min(Math.max(v, min), top) - min) / (top - min || 1)) * (height - 10),
  ]);
  const line = smooth(points);
  const area = n ? `${line} L${points[n - 1]![0]},${height} L${points[0]![0]},${height} Z` : "";
  const last = values.at(-1);
  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block h-full w-full overflow-visible" role="img" aria-label={label ? `${label}: ${last === undefined ? empty : format(last)}` : undefined}>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {n > 1 && <path d={area} fill={`url(#${id})`} />}
        {n > 0 && <path d={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {n > 0 && <circle cx={points[n - 1]![0]} cy={points[n - 1]![1]} r="3" fill={stroke} vectorEffect="non-scaling-stroke" />}
      </svg>
      {n === 0 && <div className="absolute inset-0 grid place-items-center text-[12px] text-muted-foreground">{empty}</div>}
    </div>
  );
}
