"use client";

// A dependency-free SVG chart.
//
// Charting libraries are 100–300KB and every one of them wants to own layout.
// A card only needs line/area/bar/scatter plus candlesticks, all of which are a
// path and a scale — so this is hand-drawn, renders on the server, and inherits
// theme colours instead of fighting them.

import { useId, useMemo } from "react";
import type { ChartCard } from "@agentloom/core";
import type { CardRendererProps } from "../renderer-registry.js";
import { formatValue } from "../format.js";

const PALETTE = ["var(--al-series-1)", "var(--al-series-2)", "var(--al-series-3)", "var(--al-series-4)", "var(--al-series-5)"];

const W = 720;
const H = 280;
const PAD = { top: 16, right: 52, bottom: 30, left: 56 };

type Scale = (v: number) => number;

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  // Snap to 1/2/5×10^n so labels read as round numbers rather than 0.3714.
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function ChartCardView({ spec }: CardRendererProps<ChartCard>) {
  const gradientId = useId();
  const isCandles = spec.variant === "candlestick" && spec.candles?.length;

  const model = useMemo(() => {
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    if (isCandles) {
      const candles = spec.candles!;
      const lo = Math.min(...candles.map((c) => c.l));
      const hi = Math.max(...candles.map((c) => c.h));
      const pad = (hi - lo) * 0.05 || 1;
      const yMin = lo - pad;
      const yMax = hi + pad;
      const x: Scale = (i) => PAD.left + (candles.length <= 1 ? innerW / 2 : (i / (candles.length - 1)) * innerW);
      const y: Scale = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
      return { kind: "candles" as const, candles, x, y, yTicks: niceTicks(yMin, yMax), width: Math.max(2, (innerW / candles.length) * 0.6) };
    }

    const series = spec.series ?? [];
    // Category axes index by position; numeric/time axes use the value itself.
    const categorical = spec.xType === "category" || series.some((s) => s.points.some((p) => typeof p[0] === "string"));
    const xs = series.flatMap((s) => s.points.map((p, i) => (categorical ? i : Number(p[0]))));
    const ys = series.flatMap((s) => s.points.map((p) => p[1]));
    const xMin = Math.min(...xs, 0);
    const xMax = Math.max(...xs, 1);
    const yMinRaw = Math.min(...ys, 0);
    const yMaxRaw = Math.max(...ys, 1);
    const yPad = (yMaxRaw - yMinRaw) * 0.08 || 1;
    const yMin = yMinRaw < 0 ? yMinRaw - yPad : Math.max(0, yMinRaw - yPad);
    const yMax = yMaxRaw + yPad;

    const x: Scale = (v) => PAD.left + (xMax === xMin ? innerW / 2 : ((v - xMin) / (xMax - xMin)) * innerW);
    const y: Scale = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    const labels = categorical
      ? (series[0]?.points.map((p) => String(p[0])) ?? [])
      : niceTicks(xMin, xMax, 5).map((t) => (spec.xType === "time" ? new Date(t).toLocaleDateString() : String(t)));

    return { kind: "series" as const, series, categorical, x, y, yTicks: niceTicks(yMin, yMax), labels, xMin, xMax, innerH };
  }, [spec, isCandles]);

  return (
    <div className="al-card">
      {spec.title ? <div className="al-card__title">{spec.title}</div> : null}
      <div className="al-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title ?? "chart"} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--al-series-1)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--al-series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {model.yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.left} x2={W - PAD.right} y1={model.y(t)} y2={model.y(t)} className="al-chart__grid" />
              <text x={PAD.left - 8} y={model.y(t)} className="al-chart__label" textAnchor="end" dominantBaseline="middle">
                {formatValue(t, "number")}
              </text>
            </g>
          ))}

          {model.kind === "candles"
            ? model.candles.map((c, i) => {
                const up = c.c >= c.o;
                const cx = model.x(i);
                const top = model.y(Math.max(c.o, c.c));
                const bottom = model.y(Math.min(c.o, c.c));
                return (
                  <g key={i} className={up ? "al-candle al-candle--up" : "al-candle al-candle--down"}>
                    <line x1={cx} x2={cx} y1={model.y(c.h)} y2={model.y(c.l)} />
                    <rect
                      x={cx - model.width / 2}
                      y={top}
                      width={model.width}
                      // A doji has zero body height and would vanish; floor at 1px.
                      height={Math.max(1, bottom - top)}
                    />
                  </g>
                );
              })
            : model.series.map((s, si) => {
                const color = s.color ?? PALETTE[si % PALETTE.length];
                const pts = s.points.map((p, i) => [model.x(model.categorical ? i : Number(p[0])), model.y(p[1])] as const);
                if (!pts.length) return null;

                if (s.type === "bar") {
                  const bw = Math.max(2, ((W - PAD.left - PAD.right) / Math.max(1, pts.length)) * 0.6);
                  return pts.map(([px, py], i) => (
                    <rect key={`${si}-${i}`} x={px - bw / 2} y={py} width={bw} height={Math.max(0, model.y(0) - py)} fill={color} rx={2} />
                  ));
                }
                if (s.type === "scatter") {
                  return pts.map(([px, py], i) => <circle key={`${si}-${i}`} cx={px} cy={py} r={3} fill={color} />);
                }

                const d = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
                const area = `${d} L${pts[pts.length - 1]![0].toFixed(2)},${model.y(0).toFixed(2)} L${pts[0]![0].toFixed(2)},${model.y(0).toFixed(2)} Z`;
                return (
                  <g key={si}>
                    {s.type === "area" ? <path d={area} fill={`url(#${gradientId})`} /> : null}
                    <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })}

          {(spec.annotations ?? []).map((a, i) => {
            if (a.type !== "hline") return null;
            const yy = model.y(Number(a.value));
            return (
              <g key={`a${i}`}>
                <line x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} className={`al-chart__annotation al-tone--${a.tone ?? "info"}`} />
                {a.label ? (
                  <text x={W - PAD.right + 4} y={yy} className="al-chart__label" dominantBaseline="middle">
                    {a.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="al-chart__axis" />
        </svg>
      </div>

      {model.kind === "series" && model.series.length > 1 ? (
        <div className="al-legend">
          {model.series.map((s, i) => (
            <span key={s.name} className="al-legend__item">
              <span className="al-legend__swatch" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
