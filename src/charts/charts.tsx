import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Tree } from "../lib/pipeline";
import { quantile } from "../lib/stats";
import {
  AxisBottom, AxisLeft, Tooltip, TipRow, bottomAxisSpace, extent, fmt, linear, niceTicks, placeLabels, shapePath,
  tickFmt, ticksIn, useWidth, type TipState,
} from "./core";
import { ChartTitle, domainWith, fontStyle, frame, leftMargin, type ChartOptions } from "./options";

const useTip = () => useState<TipState | null>(null);
const NO_OPTS: ChartOptions = {};

/** Mouse position relative to an element (the chart box: used to place tooltips). */
function localXY(e: React.MouseEvent, el: Element | null) {
  const r = (el ?? (e.currentTarget as Element)).getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Mouse position in SVG user units (correct even when the canvas is scrolled). */
function svgXY(e: React.MouseEvent) {
  const svg = (e.currentTarget as Element).closest("svg") ?? (e.currentTarget as Element);
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/**
 * Chart box: the outer element anchors the tooltip and never scrolls; the
 * inner canvas scrolls horizontally when a fixed width exceeds the card.
 */
function Shell({ boxRef, o, onLeave, tip, width, children, after }: {
  boxRef: React.RefObject<HTMLDivElement | null>;
  o: ChartOptions;
  onLeave?: () => void;
  tip: TipState | null;
  width: number;
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="chart" ref={boxRef} style={fontStyle(o)} onMouseLeave={onLeave}>
      <div className="chart-canvas">{width > 0 && children}</div>
      {after}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/** Category-axis labels: rotate when they don't fit side by side. */
function categoryLayout(labels: string[], plotWidth: number, k: number) {
  const maxLabel = Math.max(...labels.map((s) => s.length), 1);
  const rotate = labels.length * Math.min(7 * k * maxLabel, 90 * k) > plotWidth;
  return { rotate, space: rotate ? Math.min(140 * k, 18 + maxLabel * 5.4 * k) : 12 + 12 * k };
}

function CategoryLabel({ x, y, rotate, k, children }: { x: number; y: number; rotate: boolean; k: number; children: ReactNode }) {
  return (
    <text
      transform={rotate ? `translate(${x},${y + 8}) rotate(-45)` : `translate(${x},${y + 6 + 10 * k})`}
      textAnchor={rotate ? "end" : "middle"}
      dy={rotate ? "0.32em" : 0}
    >
      {children}
    </text>
  );
}

// ------------------------------------------------------------- bar chart

export interface Bar {
  label: string;
  value: number;
  color: string;
  tip?: ReactNode;
}

/** Vertical bars (one per sample). Bars ≥ 2px apart with rounded data ends. */
export function BarChart({ bars, height = 260, yTitle, xTitle, opts = NO_OPTS }: { bars: Bar[]; height?: number; yTitle?: string; xTitle?: string; opts?: ChartOptions }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useTip();
  const f = frame(opts, width, height);
  const yLab = opts.yLabel ?? yTitle;
  const xLab = opts.xLabel ?? xTitle;
  const ymaxAuto = Math.max(...bars.map((b) => b.value), 1);
  let ticks = niceTicks(0, ymaxAuto, 5);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : ymaxAuto;
  if ((ticks[ticks.length - 1] ?? 0) < ymaxAuto) ticks = [...ticks, (ticks[ticks.length - 1] ?? 0) + step];
  const dom = domainWith([0, ticks[ticks.length - 1]], opts.yMin, opts.yMax);
  if (opts.yMin !== undefined || opts.yMax !== undefined) ticks = ticksIn(dom, 5);
  const fmtY = (v: number) => (v >= 10000 ? `${v / 1000}k` : tickFmt(v));
  const l = leftMargin(ticks.map(fmtY), f.k, !!yLab);
  const cat = categoryLayout(bars.map((b) => b.label), f.W - l - 8, f.k);
  const m = { l, r: 8, t: 10 + f.titleH, b: cat.space + (xLab ? 20 * f.k : 0) };
  const iw = Math.max(10, f.W - m.l - m.r);
  const ih = Math.max(20, f.H - m.t - m.b);
  const y = linear(dom, [m.t + ih, m.t]);
  const base = y(Math.max(dom[0], 0));
  const band = iw / Math.max(1, bars.length);
  const bw = Math.max(2, Math.min(36, band - 2));
  return (
    <Shell boxRef={ref} o={opts} onLeave={() => setTip(null)} tip={tip} width={width}>
      <svg width={f.W} height={f.H}>
        <ChartTitle text={opts.title} W={f.W} k={f.k} />
        <AxisLeft scale={y} x={m.l} ticks={ticks} title={yLab} gridTo={f.grid ? m.l + iw : undefined} format={fmtY} k={f.k} />
        {bars.map((b, i) => {
          const cx = m.l + band * (i + 0.5);
          const top = Math.max(m.t, Math.min(base, y(b.value)));
          const h = base - top;
          const r = Math.max(0, Math.min(4, bw / 2, h));
          return (
            <g key={b.label + i}>
              {h > 0 && (
                <path
                  d={`M${cx - bw / 2},${base}V${top + r}q0,${-r} ${r},${-r}H${cx + bw / 2 - r}q${r},0 ${r},${r}V${base}Z`}
                  fill={b.color}
                />
              )}
              <rect
                x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent"
                onMouseMove={(e) => setTip({ ...localXY(e, ref.current), content: b.tip ?? <><div className="tt-title">{b.label}</div><TipRow k="Value" v={b.value.toLocaleString()} /></> })}
              />
              <CategoryLabel x={cx} y={m.t + ih} rotate={cat.rotate} k={f.k}>{b.label}</CategoryLabel>
            </g>
          );
        })}
        <line className="axis-line" x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} />
        {xLab && <text className="axis-title" x={m.l + iw / 2} y={f.H - 4} textAnchor="middle">{xLab}</text>}
      </svg>
    </Shell>
  );
}

// ------------------------------------------------------------- box plot

export interface BoxSeries {
  label: string;
  color: string;
  values: Float64Array; // sorted, finite
}

export function BoxPlot({ series, height = 280, yTitle, opts = NO_OPTS }: { series: BoxSeries[]; height?: number; yTitle?: string; opts?: ChartOptions }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useTip();
  const f = frame(opts, width, height);
  const yLab = opts.yLabel ?? yTitle;
  const stats = series.map((s) => {
    const v = s.values;
    const q1 = quantile(v, 0.25), q2 = quantile(v, 0.5), q3 = quantile(v, 0.75);
    const iqr = q3 - q1;
    let lo = q1, hi = q3;
    for (const x of v) { if (x >= q1 - 1.5 * iqr) { lo = x; break; } }
    for (let i = v.length - 1; i >= 0; i--) { if (v[i] <= q3 + 1.5 * iqr) { hi = v[i]; break; } }
    return { ...s, q1, q2, q3, lo, hi, n: v.length };
  });
  const dom = domainWith(extent(stats.flatMap((s) => [s.lo, s.hi]), 0.06), opts.yMin, opts.yMax);
  const ticks = ticksIn(dom, 5);
  const l = leftMargin(ticks.map(tickFmt), f.k, !!yLab);
  const cat = categoryLayout(series.map((s) => s.label), f.W - l - 8, f.k);
  const m = { l, r: 8, t: 10 + f.titleH, b: cat.space + (opts.xLabel ? 20 * f.k : 0) };
  const iw = Math.max(10, f.W - m.l - m.r);
  const ih = Math.max(20, f.H - m.t - m.b);
  const y = linear(dom, [m.t + ih, m.t]);
  const cy = (v: number) => Math.max(m.t, Math.min(m.t + ih, y(v)));
  const band = iw / Math.max(1, series.length);
  const bw = Math.max(4, Math.min(28, band * 0.6));
  return (
    <Shell boxRef={ref} o={opts} onLeave={() => setTip(null)} tip={tip} width={width}>
      <svg width={f.W} height={f.H}>
        <ChartTitle text={opts.title} W={f.W} k={f.k} />
        <AxisLeft scale={y} x={m.l} ticks={ticks} title={yLab} gridTo={f.grid ? m.l + iw : undefined} k={f.k} />
        {stats.map((s, i) => {
          const cx = m.l + band * (i + 0.5);
          return (
            <g key={s.label + i}>
              {s.n > 0 && (
                <>
                  <line x1={cx} x2={cx} y1={cy(s.lo)} y2={cy(s.q1)} stroke={s.color} strokeWidth={1.5} />
                  <line x1={cx} x2={cx} y1={cy(s.q3)} y2={cy(s.hi)} stroke={s.color} strokeWidth={1.5} />
                  <rect x={cx - bw / 2} y={cy(s.q3)} width={bw} height={Math.max(1, cy(s.q1) - cy(s.q3))} rx={3} fill={s.color} fillOpacity={0.22} stroke={s.color} strokeWidth={1.5} />
                  {s.q2 >= dom[0] && s.q2 <= dom[1] && <line x1={cx - bw / 2} x2={cx + bw / 2} y1={y(s.q2)} y2={y(s.q2)} stroke={s.color} strokeWidth={2.5} />}
                </>
              )}
              <rect
                x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent"
                onMouseMove={(e) => setTip({ ...localXY(e, ref.current), content: <><div className="tt-title">{s.label}</div><TipRow k="Median" v={fmt(s.q2)} /><TipRow k="IQR" v={`${fmt(s.q1)} – ${fmt(s.q3)}`} /><TipRow k="n" v={s.n.toLocaleString()} /></> })}
              />
              <CategoryLabel x={cx} y={m.t + ih} rotate={cat.rotate} k={f.k}>{s.label}</CategoryLabel>
            </g>
          );
        })}
        <line className="axis-line" x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} />
        {opts.xLabel && <text className="axis-title" x={m.l + iw / 2} y={f.H - 4} textAnchor="middle">{opts.xLabel}</text>}
      </svg>
    </Shell>
  );
}

// ------------------------------------------------------------- density lines

export interface DensitySeries {
  label: string;
  color: string;
  values: ArrayLike<number>;
  dashed?: boolean;
}

export function DensityChart({ series, height = 260, xTitle, normalize = true, opts = NO_OPTS }: { series: DensitySeries[]; height?: number; xTitle?: string; normalize?: boolean; opts?: ChartOptions }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; bin: number } | null>(null);
  const f = frame(opts, width, height);
  const bins = 60;
  const auto = useMemo(() => extent(series.flatMap((s) => Array.from(s.values)), 0.02), [series]);
  const dom = domainWith(auto, opts.xMin, opts.xMax);
  const step = (dom[1] - dom[0]) / bins;
  const curves = useMemo(
    () =>
      series.map((s) => {
        const c = new Float64Array(bins);
        let n = 0;
        for (let i = 0; i < s.values.length; i++) {
          const v = s.values[i];
          if (!Number.isFinite(v)) continue;
          n++;
          if (v < dom[0] || v > dom[1]) continue;
          c[Math.min(bins - 1, Math.max(0, Math.floor((v - dom[0]) / step)))]++;
        }
        const sm = c.map((_, i) => (0.25 * (c[i - 1] ?? c[i]) + 0.5 * c[i] + 0.25 * (c[i + 1] ?? c[i])));
        return { ...s, d: normalize ? sm.map((v) => (n ? v / n / step : 0)) : sm, n };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, dom[0], dom[1]],
  );
  const yLab = opts.yLabel ?? (normalize ? "Density" : "Count");
  const xLab = opts.xLabel ?? xTitle;
  const ymaxAuto = Math.max(...curves.flatMap((c) => Array.from(c.d)), 1e-9) * 1.05;
  const yd = domainWith([0, ymaxAuto], opts.yMin, opts.yMax);
  const yt = ticksIn(yd, 4);
  const fmtY = (v: number) => fmt(v, v < 1 ? 2 : 0);
  const m = { l: leftMargin(yt.map(fmtY), f.k, true), r: 10, t: 10 + f.titleH, b: bottomAxisSpace(f.k, !!xLab) };
  const iw = Math.max(10, f.W - m.l - m.r);
  const ih = Math.max(20, f.H - m.t - m.b);
  const x = linear(dom, [m.l, m.l + iw]);
  const y = linear(yd, [m.t + ih, m.t]);
  const clip = (v: number) => Math.max(m.t, Math.min(m.t + ih, y(v)));
  return (
    <Shell
      boxRef={ref} o={opts} onLeave={() => setHover(null)} width={width}
      tip={hover && {
        x: hover.x, y: hover.y,
        content: (
          <>
            <div className="tt-title">{fmt(dom[0] + hover.bin * step)} – {fmt(dom[0] + (hover.bin + 1) * step)}</div>
            {curves.map((c) => <TipRow key={c.label} k={c.label} v={normalize ? fmt(c.d[hover.bin], 3) : Math.round(c.d[hover.bin])} />)}
          </>
        ),
      }}
    >
      <svg
        width={f.W} height={f.H}
        onMouseMove={(e) => {
          const p = svgXY(e);
          const bin = Math.floor(((p.x - m.l) / iw) * bins);
          setHover(bin >= 0 && bin < bins ? { ...localXY(e, ref.current), bin } : null);
        }}
      >
        <ChartTitle text={opts.title} W={f.W} k={f.k} />
        <AxisLeft scale={y} x={m.l} ticks={yt} title={yLab} gridTo={f.grid ? m.l + iw : undefined} format={fmtY} k={f.k} />
        <AxisBottom scale={x} y={m.t + ih} ticks={ticksIn(dom, 7)} title={xLab} k={f.k} />
        {curves.map((c) => (
          <path
            key={c.label}
            d={Array.from(c.d).map((v, i) => `${i ? "L" : "M"}${x(dom[0] + (i + 0.5) * step).toFixed(1)},${clip(v).toFixed(1)}`).join("")}
            fill="none" stroke={c.color} strokeWidth={2} strokeDasharray={c.dashed ? "5 4" : undefined} strokeLinejoin="round"
          />
        ))}
        {hover && <line className="axis-line" x1={x(dom[0] + (hover.bin + 0.5) * step)} x2={x(dom[0] + (hover.bin + 0.5) * step)} y1={m.t} y2={m.t + ih} strokeDasharray="3 3" />}
      </svg>
    </Shell>
  );
}

// ------------------------------------------------------------- scatter (PCA)

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  color: string;
  shape: number;
  tip: ReactNode;
}

export function Scatter({ points, height = 420, xTitle, yTitle, showLabels, opts = NO_OPTS }: { points: ScatterPoint[]; height?: number; xTitle: string; yTitle: string; showLabels: boolean; opts?: ChartOptions }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useTip();
  const f = frame(opts, width, height);
  const xLab = opts.xLabel ?? xTitle;
  const yLab = opts.yLabel ?? yTitle;
  const ps = opts.pointSize ?? 6;
  const xd = domainWith(extent(points.map((p) => p.x), 0.12), opts.xMin, opts.xMax);
  const yd = domainWith(extent(points.map((p) => p.y), 0.12), opts.yMin, opts.yMax);
  const yt = ticksIn(yd, 6);
  const m = { l: leftMargin(yt.map(tickFmt), f.k, true), r: 16, t: 14 + f.titleH, b: bottomAxisSpace(f.k, true) };
  const iw = Math.max(10, f.W - m.l - m.r);
  const ih = Math.max(20, f.H - m.t - m.b);
  const x = linear(xd, [m.l, m.l + iw]);
  const y = linear(yd, [m.t + ih, m.t]);
  const inside = (p: ScatterPoint) => p.x >= xd[0] && p.x <= xd[1] && p.y >= yd[0] && p.y <= yd[1];
  const visible = points.filter(inside);
  const labels = showLabels
    ? placeLabels(
        visible.map((p) => ({ x: x(p.x), y: y(p.y), text: p.label, right: x(p.x) < m.l + iw * 0.75 })),
        { x0: m.l, x1: m.l + iw + m.r, y0: f.titleH, y1: m.t + ih },
        visible.map((p) => ({ x: x(p.x), y: y(p.y) })), ps + 1, 6.3 * f.k, 13 * f.k,
      )
    : [];
  return (
    <Shell boxRef={ref} o={opts} onLeave={() => setTip(null)} tip={tip} width={width}>
      <svg width={f.W} height={f.H}>
        <ChartTitle text={opts.title} W={f.W} k={f.k} />
        <AxisLeft scale={y} x={m.l} ticks={yt} title={yLab} gridTo={f.grid ? m.l + iw : undefined} k={f.k} />
        <AxisBottom scale={x} y={m.t + ih} ticks={ticksIn(xd, 7)} title={xLab} k={f.k} />
        {xd[0] < 0 && xd[1] > 0 && <line className="axis-line" x1={x(0)} x2={x(0)} y1={m.t} y2={m.t + ih} strokeDasharray="2 4" />}
        {visible.map((p, i) => (
          <g key={i}>
            <path d={shapePath(p.shape, x(p.x), y(p.y), ps)} fill={p.color} stroke="var(--surface)" strokeWidth={2} paintOrder="stroke" />
            <circle cx={x(p.x)} cy={y(p.y)} r={Math.max(12, ps + 4)} fill="transparent" onMouseMove={(e) => setTip({ ...localXY(e, ref.current), content: p.tip })} />
          </g>
        ))}
        {labels.map((l) => (
          <g key={l.text} style={{ pointerEvents: "none" }}>
            {Math.abs(l.ly - l.y) > 3 && <line x1={l.x} y1={l.y} x2={l.lx} y2={l.ly} stroke="var(--axis)" strokeWidth={0.75} />}
            <text x={l.lx} y={l.ly} dy="0.32em" textAnchor={l.anchor} stroke="var(--surface)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{l.text}</text>
          </g>
        ))}
      </svg>
    </Shell>
  );
}

// ------------------------------------------------------------- volcano

export interface VolcanoPoint {
  x: number; // logFC
  y: number; // -log10 p
  cls: 0 | 1 | -1; // ns / up / down
  label: string;
  idx: number;
}

const circ = (x: number, y: number, r: number) => `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;

export const volcanoColors = (o: ChartOptions) => ({
  up: o.colorUp ?? "var(--up)",
  down: o.colorDown ?? "var(--down)",
  ns: o.colorNs ?? "var(--ns)",
});

export const volcanoDefaultPointSize = (n: number) => (n > 4000 ? 2.6 : 3.4);

export function Volcano({
  points, lfc, pLine, highlight, selected, onSelect, nLabels, yTitle, height = 460, opts = NO_OPTS,
}: {
  points: VolcanoPoint[];
  lfc: number;
  pLine: number | null;
  highlight: Set<number>;
  selected: number | null;
  onSelect: (idx: number) => void;
  nLabels: number;
  yTitle: string;
  height?: number;
  opts?: ChartOptions;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ p: VolcanoPoint; x: number; y: number } | null>(null);
  const f = frame(opts, width, height);
  const col = volcanoColors(opts);
  const xLab = opts.xLabel ?? "log₂ fold change";
  const yLab = opts.yLabel ?? yTitle;
  const xmaxAuto = Math.max(1.5, ...points.map((p) => Math.abs(p.x)).filter(Number.isFinite)) * 1.06;
  const ymaxAuto = Math.max(2, ...points.map((p) => p.y).filter(Number.isFinite)) * 1.05;
  const xd = domainWith([-xmaxAuto, xmaxAuto], opts.xMin, opts.xMax);
  const yd = domainWith([0, ymaxAuto], opts.yMin, opts.yMax);
  const yt = ticksIn(yd, 6);
  const m = { l: leftMargin(yt.map(tickFmt), f.k, true), r: 16, t: 14 + f.titleH, b: bottomAxisSpace(f.k, true) };
  const iw = Math.max(10, f.W - m.l - m.r);
  const ih = Math.max(20, f.H - m.t - m.b);
  const x = linear(xd, [m.l, m.l + iw]);
  const y = linear(yd, [m.t + ih, m.t]);
  const r = opts.pointSize ?? volcanoDefaultPointSize(points.length);
  const key = [f.W, f.H, xd[0], xd[1], yd[0], yd[1], r, f.k, f.titleH].join();
  const inside = (p: VolcanoPoint) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= xd[0] && p.x <= xd[1] && p.y >= yd[0] && p.y <= yd[1];

  const paths = useMemo(() => {
    const d = { ns: "", up: "", down: "" };
    for (const p of points) {
      if (!inside(p)) continue;
      const s = circ(x(p.x), y(p.y), r);
      if (p.cls === 1) d.up += s;
      else if (p.cls === -1) d.down += s;
      else d.ns += s;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, key]);

  const labelled = useMemo(() => {
    const sig = points.filter((p) => p.cls !== 0 && inside(p)).sort((a, b) => b.y - a.y || Math.abs(b.x) - Math.abs(a.x));
    // Explicitly requested labels first so they always win placement.
    const wanted: VolcanoPoint[] = [];
    const seen = new Set<number>();
    const add = (p: VolcanoPoint | undefined) => { if (p && !seen.has(p.idx) && inside(p)) { seen.add(p.idx); wanted.push(p); } };
    if (selected !== null) add(points.find((p) => p.idx === selected));
    for (const p of points) if (highlight.has(p.idx)) add(p);
    sig.slice(0, nLabels).forEach(add);
    const placed = placeLabels(
      wanted.map((p) => ({ x: x(p.x), y: y(p.y), text: p.label, right: p.x >= 0 })),
      { x0: m.l, x1: m.l + iw + m.r, y0: f.titleH, y1: m.t + ih },
      sig.map((p) => ({ x: x(p.x), y: y(p.y) })), r, 6.3 * f.k, 13 * f.k,
    );
    const byPos = new Map(wanted.map((p) => [`${x(p.x)},${y(p.y)},${p.label}`, p]));
    return placed.map((l) => ({ p: byPos.get(`${l.x},${l.y},${l.text}`)!, lx: l.lx, ly: l.ly, anchor: l.anchor }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, nLabels, highlight, selected, key]);

  const nearest = (mx: number, my: number) => {
    let best: VolcanoPoint | null = null;
    let bd = 144;
    for (const p of points) {
      if (!inside(p)) continue;
      const dx = x(p.x) - mx, dy = y(p.y) - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  return (
    <Shell
      boxRef={ref} o={opts} onLeave={() => setHover(null)} width={width}
      tip={hover && {
        x: hover.x, y: hover.y,
        content: (
          <>
            <div className="tt-title">{hover.p.label}</div>
            <TipRow k="log₂FC" v={fmt(hover.p.x)} />
            <TipRow k={yTitle} v={fmt(hover.p.y)} />
            <div className="muted small" style={{ marginTop: 4 }}>Click to inspect</div>
          </>
        ),
      }}
    >
      <svg
        width={f.W} height={f.H} style={{ cursor: hover ? "pointer" : "default" }}
        onMouseMove={(e) => { const q = svgXY(e); const p = nearest(q.x, q.y); setHover(p ? { p, ...localXY(e, ref.current) } : null); }}
        onClick={(e) => { const q = svgXY(e); const p = nearest(q.x, q.y); if (p) onSelect(p.idx); }}
      >
        <ChartTitle text={opts.title} W={f.W} k={f.k} />
        <AxisLeft scale={y} x={m.l} ticks={yt} title={yLab} gridTo={f.grid ? m.l + iw : undefined} k={f.k} />
        <AxisBottom scale={x} y={m.t + ih} ticks={ticksIn(xd, 8)} title={xLab} k={f.k} />
        {lfc > 0 && [-lfc, lfc].filter((v) => v > xd[0] && v < xd[1]).map((v) => <line key={v} className="axis-line" x1={x(v)} x2={x(v)} y1={m.t} y2={m.t + ih} strokeDasharray="4 4" />)}
        {pLine !== null && Number.isFinite(pLine) && pLine > yd[0] && pLine < yd[1] && <line className="axis-line" x1={m.l} x2={m.l + iw} y1={y(pLine)} y2={y(pLine)} strokeDasharray="4 4" />}
        <path d={paths.ns} fill={col.ns} />
        <path d={paths.down} fill={col.down} stroke="var(--surface)" strokeWidth={0.75} fillOpacity={0.9} />
        <path d={paths.up} fill={col.up} stroke="var(--surface)" strokeWidth={0.75} fillOpacity={0.9} />
        {labelled.map(({ p, lx, ly, anchor }) => {
          const px = x(p.x), py = y(p.y);
          const strong = highlight.has(p.idx) || p.idx === selected;
          return (
            <g key={p.idx} style={{ pointerEvents: "none" }}>
              {strong && <circle cx={px} cy={py} r={r + 3} fill="none" stroke="var(--text)" strokeWidth={1.5} />}
              {Math.abs(ly - py) > 3 && <line x1={px} y1={py} x2={lx} y2={ly} stroke="var(--axis)" strokeWidth={0.75} />}
              <text x={lx} y={ly} dy="0.32em" textAnchor={anchor} className={strong ? "label-strong" : undefined} stroke="var(--surface)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
                {p.label}
              </text>
            </g>
          );
        })}
        {hover && <circle cx={x(hover.p.x)} cy={y(hover.p.y)} r={r + 2.5} fill="none" stroke="var(--text)" strokeWidth={1.5} style={{ pointerEvents: "none" }} />}
      </svg>
    </Shell>
  );
}

// ------------------------------------------------------------- heatmap

function dendroPaths(tree: Tree, pos: (leaf: number) => number, hScale: (h: number) => number, vertical: boolean): string {
  let d = "";
  const walk = (t: Tree): [number, number] => {
    if (t.leaf !== undefined) return [pos(t.leaf), hScale(0)];
    const [a, ha] = walk(t.left!);
    const [b, hb] = walk(t.right!);
    const h = hScale(t.height);
    if (vertical) d += `M${a},${ha}V${h}H${b}V${hb}`;
    else d += `M${ha},${a}H${h}V${b}H${hb}`;
    return [(a + b) / 2, h];
  };
  walk(tree);
  return d;
}

export function Heatmap({
  values, rowLabels, colLabels, colColors, color, rowTree, colTree, rowOrder, colOrder, cellTip, height,
  legend, onRowClick, square, opts = NO_OPTS,
}: {
  values: number[][]; // [row][col]
  rowLabels: string[];
  colLabels: string[];
  colColors?: string[];
  color: (v: number) => string;
  rowTree?: Tree;
  colTree?: Tree;
  rowOrder: number[];
  colOrder: number[];
  cellTip: (r: number, c: number) => ReactNode;
  height?: number;
  legend?: ReactNode;
  onRowClick?: (r: number) => void;
  square?: boolean;
  opts?: ChartOptions;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useTip();
  const f = frame(opts, width, height ?? 520);
  const k = f.k;
  const nR = rowOrder.length, nC = colOrder.length;
  const showRowLabels = opts.rowLabels === "show" || (opts.rowLabels !== "hide" && nR <= 90);
  const rowLabelW = showRowLabels ? Math.min(180 * k, 12 + 6.3 * k * Math.max(...rowLabels.map((s) => s.length), 1)) : 0;
  const colLabelH = Math.min(140 * k, 14 + 5.6 * k * Math.max(...colLabels.map((s) => s.length), 1));
  const dendroW = rowTree ? 56 : 0;
  const dendroH = colTree ? 44 : 0;
  const annoH = colColors ? 12 : 0;
  const m = { l: dendroW + 4, t: f.titleH + dendroH + annoH + 6, r: rowLabelW, b: colLabelH };
  const iw = Math.max(10, f.W - m.l - m.r);
  const cw = iw / Math.max(1, nC);
  const ch = square
    ? Math.min(cw, opts.height ? Math.max(4, (opts.height - m.t - m.b) / Math.max(1, nR)) : 40)
    : Math.max(nR > 200 ? 1.6 : 3, Math.min(opts.height ? 60 : 16, (f.H - m.t - m.b) / Math.max(1, nR)));
  const ih = ch * nR;
  const svgW = square && !opts.width ? m.l + cw * nC + m.r : f.W;
  const H = m.t + ih + m.b;
  const colPos = new Map(colOrder.map((c, i) => [c, m.l + (i + 0.5) * cw]));
  const rowPos = new Map(rowOrder.map((r, i) => [r, m.t + (i + 0.5) * ch]));
  const colMaxH = colTree?.height || 1;
  const rowMaxH = rowTree?.height || 1;

  return (
    <Shell boxRef={ref} o={opts} onLeave={() => setTip(null)} tip={tip} width={width} after={legend}>
      <svg width={svgW} height={H}>
        <ChartTitle text={opts.title} W={svgW} k={k} />
        {colTree && (
          <path
            d={dendroPaths(colTree, (l) => colPos.get(l)!, (h) => f.titleH + dendroH - 2 - (h / colMaxH) * (dendroH - 6), true)}
            fill="none" stroke="var(--axis)" strokeWidth={1}
          />
        )}
        {rowTree && (
          <path
            d={dendroPaths(rowTree, (l) => rowPos.get(l)!, (h) => dendroW - (h / rowMaxH) * (dendroW - 4), false)}
            fill="none" stroke="var(--axis)" strokeWidth={1}
          />
        )}
        {colColors && colOrder.map((c, i) => (
          <rect key={`a${c}`} x={m.l + i * cw + 0.5} y={f.titleH + dendroH + 2} width={Math.max(0.5, cw - 1)} height={annoH - 3} rx={2} fill={colColors[c]} />
        ))}
        <g shapeRendering={nR * nC > 4000 ? "crispEdges" : undefined}>
          {rowOrder.map((r, i) =>
            colOrder.map((c, j) => (
              <rect key={`${r}-${c}`} x={m.l + j * cw} y={m.t + i * ch} width={cw + 0.3} height={ch + 0.3} fill={color(values[r][c])} />
            )),
          )}
        </g>
        {showRowLabels && rowOrder.map((r, i) => (
          <text key={`rl${r}`} x={m.l + nC * cw + 6} y={m.t + (i + 0.5) * ch} dy="0.32em" style={{ fontSize: Math.min(11 * k, Math.max(4, ch * 0.85)) }}>
            {rowLabels[r]}
          </text>
        ))}
        {colOrder.map((c, j) => (
          <text key={`cl${c}`} transform={`translate(${m.l + (j + 0.5) * cw},${m.t + ih + 6}) rotate(-50)`} textAnchor="end" dy="0.32em">
            {colLabels[c]}
          </text>
        ))}
        <rect
          x={m.l} y={m.t} width={nC * cw} height={ih} fill="transparent" style={{ cursor: onRowClick ? "pointer" : "default" }}
          onMouseMove={(e) => {
            const p = svgXY(e);
            const j = Math.floor((p.x - m.l) / cw), i = Math.floor((p.y - m.t) / ch);
            if (i >= 0 && i < nR && j >= 0 && j < nC) setTip({ ...localXY(e, ref.current), content: cellTip(rowOrder[i], colOrder[j]) });
            else setTip(null);
          }}
          onClick={(e) => {
            if (!onRowClick) return;
            const i = Math.floor((svgXY(e).y - m.t) / ch);
            if (i >= 0 && i < nR) onRowClick(rowOrder[i]);
          }}
        />
      </svg>
    </Shell>
  );
}

/** Horizontal gradient legend for continuous color scales. */
export function GradientLegend({ color, min, max, label }: { color: (t: number) => string; min: number; max: number; label: string }) {
  const stops = Array.from({ length: 11 }, (_, i) => color(i / 10));
  return (
    <div className="row small muted" style={{ gap: 8, marginTop: 8 }}>
      <span>{label}</span>
      <span>{fmt(min, 1)}</span>
      <span style={{ width: 140, height: 10, borderRadius: 3, background: `linear-gradient(90deg, ${stops.join(",")})` }} />
      <span>{fmt(max, 1)}</span>
    </div>
  );
}

// ------------------------------------------------------------- missingness raster

/** Binary presence/absence map drawn to a canvas and embedded as an image. */
export function MissingMap({ present, colLabels, colColors, height = 300, opts = NO_OPTS }: { present: Uint8Array[]; colLabels: string[]; colColors: string[]; height?: number; opts?: ChartOptions }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [src, setSrc] = useState<string>("");
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const f = frame(opts, width, height);
  const nC = present.length;
  const nR = present[0]?.length ?? 0;
  useEffect(() => {
    if (!nR || !nC) return;
    const cs = getComputedStyle(document.documentElement);
    const on = cs.getPropertyValue("--series-1").trim() || "#2a78d6";
    const off = cs.getPropertyValue("--surface-3").trim() || "#eee";
    const c = (canvas.current ??= document.createElement("canvas"));
    const rows = Math.min(nR, 800);
    c.width = nC;
    c.height = rows;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = off;
    ctx.fillRect(0, 0, nC, rows);
    ctx.fillStyle = on;
    for (let i = 0; i < rows; i++) {
      const r = Math.floor((i * nR) / rows);
      for (let j = 0; j < nC; j++) if (present[j][r]) ctx.fillRect(j, i, 1, 1);
    }
    setSrc(c.toDataURL());
  }, [present, nR, nC]);
  const maxLabel = Math.max(...colLabels.map((s) => s.length), 1);
  const m = { l: 8, r: 8, t: 14 + f.titleH, b: Math.min(140 * f.k, 14 + maxLabel * 5.6 * f.k) };
  const iw = Math.max(10, f.W - m.l - m.r);
  const ih = Math.max(20, f.H - m.t - m.b);
  const cw = iw / Math.max(1, nC);
  return (
    <Shell boxRef={ref} o={opts} tip={null} width={width}>
      <svg width={f.W} height={f.H}>
        <ChartTitle text={opts.title} W={f.W} k={f.k} />
        {colColors.map((col, j) => <rect key={j} x={m.l + j * cw + 0.5} y={f.titleH} width={Math.max(0.5, cw - 1)} height={9} rx={2} fill={col} />)}
        {src && <image href={src} x={m.l} y={m.t} width={iw} height={ih} preserveAspectRatio="none" style={{ imageRendering: "pixelated" }} />}
        {colLabels.map((l, j) => (
          <text key={j} transform={`translate(${m.l + (j + 0.5) * cw},${m.t + ih + 6}) rotate(-50)`} textAnchor="end" dy="0.32em">{l}</text>
        ))}
      </svg>
    </Shell>
  );
}

// ------------------------------------------------------------- protein dot plot

export interface DotGroup {
  label: string;
  color: string;
  shape: number;
  points: { v: number; imputed: boolean; sample: string }[];
}

export function DotPlot({ groups, height = 280, yTitle }: { groups: DotGroup[]; height?: number; yTitle: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useTip();
  const dom = extent(groups.flatMap((g) => g.points.map((p) => p.v)), 0.15);
  const yt = ticksIn(dom, 5);
  const m = { l: leftMargin(yt.map(tickFmt), 1, true), r: 10, t: 12, b: 34 };
  const iw = Math.max(10, width - m.l - m.r);
  const ih = height - m.t - m.b;
  const y = linear(dom, [m.t + ih, m.t]);
  const band = iw / Math.max(1, groups.length);
  return (
    <Shell boxRef={ref} o={NO_OPTS} onLeave={() => setTip(null)} tip={tip} width={width}>
      <svg width={width} height={height}>
        <AxisLeft scale={y} x={m.l} ticks={yt} title={yTitle} gridTo={m.l + iw} />
        {groups.map((g, gi) => {
          const cx = m.l + band * (gi + 0.5);
          const obs = g.points.filter((p) => Number.isFinite(p.v));
          const mu = obs.length ? obs.reduce((s, p) => s + p.v, 0) / obs.length : NaN;
          return (
            <g key={g.label}>
              {Number.isFinite(mu) && <line x1={cx - Math.min(30, band * 0.3)} x2={cx + Math.min(30, band * 0.3)} y1={y(mu)} y2={y(mu)} stroke="var(--text-2)" strokeWidth={2} strokeLinecap="round" />}
              {g.points.map((p, k) => {
                if (!Number.isFinite(p.v)) return null;
                const jitter = ((k * 0.618) % 1 - 0.5) * Math.min(36, band * 0.45);
                const px = cx + jitter, py = y(p.v);
                return (
                  <g key={k}>
                    <path d={shapePath(g.shape, px, py, 5.5)} fill={p.imputed ? "var(--surface)" : g.color} stroke={g.color} strokeWidth={p.imputed ? 1.75 : 0} />
                    <circle cx={px} cy={py} r={10} fill="transparent" onMouseMove={(e) => setTip({ ...localXY(e, ref.current), content: <><div className="tt-title">{p.sample}</div><TipRow k="log₂ intensity" v={fmt(p.v)} />{p.imputed && <div className="muted small">Imputed value</div>}</> })} />
                  </g>
                );
              })}
              <text x={cx} y={m.t + ih + 18} textAnchor="middle">{g.label}</text>
            </g>
          );
        })}
        <line className="axis-line" x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} />
      </svg>
    </Shell>
  );
}
