import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { OptionsPanel, useChartOptions, type OptionDefaults, type OptionField } from "./options";

// ---------------------------------------------------------------- scales

export type Scale = ((v: number) => number) & { domain: [number, number]; range: [number, number] };

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => r0 + (v - d0) * k) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function extent(values: Iterable<number>, pad = 0): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

export const fmt = (v: number, digits = 2) => {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(digits === 0 ? 0 : Math.min(2, digits));
  return v.toFixed(digits);
};
export const fmtP = (p: number) => (!Number.isFinite(p) ? "–" : p < 1e-4 ? p.toExponential(2) : p.toPrecision(3));
export const tickFmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e4) return v.toExponential(0);
  return String(+v.toFixed(6));
};

// ---------------------------------------------------------------- colors

export const seriesColor = (i: number) => (i < 8 ? `var(--series-${i + 1})` : "var(--series-other)");

/** Marker shapes give conditions a secondary, non-colour encoding. */
export const SHAPES = ["circle", "square", "triangle", "diamond", "triangle-down", "cross", "star", "hex"] as const;
export function shapePath(i: number, x: number, y: number, r: number): string {
  const s = SHAPES[i % SHAPES.length];
  switch (s) {
    case "circle":
      return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
    case "square": {
      const h = r * 0.88;
      return `M${x - h},${y - h}h${2 * h}v${2 * h}h${-2 * h}Z`;
    }
    case "triangle":
      return `M${x},${y - r * 1.15}L${x + r * 1.05},${y + r * 0.75}L${x - r * 1.05},${y + r * 0.75}Z`;
    case "triangle-down":
      return `M${x},${y + r * 1.15}L${x + r * 1.05},${y - r * 0.75}L${x - r * 1.05},${y - r * 0.75}Z`;
    case "diamond":
      return `M${x},${y - r * 1.2}L${x + r * 1.2},${y}L${x},${y + r * 1.2}L${x - r * 1.2},${y}Z`;
    case "cross": {
      const a = r * 0.4, b = r * 1.05;
      return `M${x - a},${y - b}h${2 * a}v${b - a}h${b - a}v${2 * a}h${a - b}v${b - a}h${-2 * a}v${a - b}h${a - b}v${-2 * a}h${b - a}Z`;
    }
    case "star": {
      let d = "";
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? r * 0.5 : r * 1.25;
        const ang = -Math.PI / 2 + (k * Math.PI) / 5;
        d += `${k ? "L" : "M"}${x + rr * Math.cos(ang)},${y + rr * Math.sin(ang)}`;
      }
      return d + "Z";
    }
    default: {
      let d = "";
      for (let k = 0; k < 6; k++) {
        const ang = (k * Math.PI) / 3;
        d += `${k ? "L" : "M"}${x + r * 1.1 * Math.cos(ang)},${y + r * 1.1 * Math.sin(ang)}`;
      }
      return d + "Z";
    }
  }
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toLin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
function toOklab([r, g, b]: RGB): RGB {
  const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: RGB): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bb = fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return `rgb(${r},${g},${bb})`;
}

/** Piecewise OKLab interpolation through hex stops, t in [0, 1]. */
export function ramp(stops: string[]) {
  const labs = stops.map((s) => toOklab(hex(s)));
  return (t: number) => {
    if (!Number.isFinite(t)) return "transparent";
    t = Math.min(1, Math.max(0, t));
    const pos = t * (labs.length - 1);
    const i = Math.min(labs.length - 2, Math.floor(pos));
    const f = pos - i;
    const a = labs[i], b = labs[i + 1];
    return fromOklab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  };
}

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** Re-render when the effective theme changes (for colors computed in JS). */
export function useThemeVersion(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const update = () => setDark(isDark());
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq?.removeEventListener("change", update);
      obs.disconnect();
    };
  }, []);
  return dark;
}

export const divergingRamp = (dark: boolean) =>
  ramp(dark ? ["#3987e5", "#256abf", "#383835", "#b8403f", "#e66767"] : ["#184f95", "#6da7ec", "#f0efec", "#ec8c8b", "#b0302f"]);
export const sequentialRamp = (dark: boolean) =>
  ramp(dark ? ["#20201f", "#184f95", "#3987e5", "#9ec5f4"] : ["#f3f7fd", "#9ec5f4", "#3987e5", "#104281"]);

// ---------------------------------------------------------------- sizing

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---------------------------------------------------------------- tooltip

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

export function Tooltip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const left = tip.x > width - 200 ? tip.x - 14 : tip.x + 14;
  return (
    <div
      className="tooltip"
      style={{ left, top: tip.y + 12, transform: tip.x > width - 200 ? "translateX(-100%)" : undefined }}
    >
      {tip.content}
    </div>
  );
}

export const TipRow = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="tt-row">
    <span>{k}</span>
    <b>{v}</b>
  </div>
);

// ---------------------------------------------------------------- axes

export function AxisBottom({ scale, y, ticks, title, format = tickFmt, k = 1 }: { scale: Scale; y: number; ticks: number[]; title?: string; format?: (v: number) => string; k?: number }) {
  const [r0, r1] = scale.range;
  return (
    <g>
      <line className="axis-line" x1={r0} x2={r1} y1={y} y2={y} />
      {ticks.map((t) => (
        <g key={t} transform={`translate(${scale(t)},${y})`}>
          <line className="axis-line" y2={4} />
          <text y={6 + 10 * k} textAnchor="middle">{format(t)}</text>
        </g>
      ))}
      {title && <text className="axis-title" x={(r0 + r1) / 2} y={y + 12 + 22 * k} textAnchor="middle">{title}</text>}
    </g>
  );
}

/** Height needed under a bottom axis (ticks + optional title). */
export const bottomAxisSpace = (k: number, hasTitle: boolean) => Math.ceil(10 + 12 * k + (hasTitle ? 20 * k : 0));

export function AxisLeft({ scale, x, ticks, title, format = tickFmt, gridTo, k = 1 }: { scale: Scale; x: number; ticks: number[]; title?: string; format?: (v: number) => string; gridTo?: number; k?: number }) {
  const [r0, r1] = scale.range;
  const labels = ticks.map(format);
  const labelW = Math.max(1, ...labels.map((l) => l.length)) * 6.3 * k;
  return (
    <g>
      {gridTo !== undefined && ticks.map((t) => <line key={`g${t}`} className="grid-line" x1={x} x2={gridTo} y1={scale(t)} y2={scale(t)} />)}
      <line className="axis-line" x1={x} x2={x} y1={r0} y2={r1} />
      {ticks.map((t, i) => (
        <g key={t} transform={`translate(${x},${scale(t)})`}>
          <line className="axis-line" x2={-4} />
          <text x={-7} dy="0.32em" textAnchor="end">{labels[i]}</text>
        </g>
      ))}
      {title && (
        <text className="axis-title" transform={`translate(${x - labelW - 12 - 6 * k},${(r0 + r1) / 2}) rotate(-90)`} textAnchor="middle">
          {title}
        </text>
      )}
    </g>
  );
}

/** Ticks inside a domain, keeping only those that fall within it. */
export const ticksIn = (d: [number, number], n: number) => niceTicks(d[0], d[1], n).filter((t) => t >= d[0] - 1e-9 && t <= d[1] + 1e-9);

// ---------------------------------------------------------------- export

const STYLE_PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-weight", "font-family", "text-anchor", "dominant-baseline", "paint-order", "stroke-linejoin"];

function inlineStyles(src: SVGElement, dst: SVGElement) {
  const cs = getComputedStyle(src);
  const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
  dst.setAttribute("style", style);
  // Drop presentation attributes that reference CSS variables; the resolved
  // values now live in the inline style, so other SVG tools can read them.
  for (const attr of [...dst.attributes]) if (attr.value.includes("var(")) dst.removeAttribute(attr.name);
  const sk = src.children;
  const dk = dst.children;
  for (let i = 0; i < sk.length; i++) inlineStyles(sk[i] as SVGElement, dk[i] as SVGElement);
}

function serialize(svg: SVGSVGElement): { text: string; w: number; h: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  const w = svg.width.baseVal.value;
  const h = svg.height.baseVal.value;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${-8} ${-8} ${w + 16} ${h + 16}`);
  clone.setAttribute("width", String(w + 16));
  clone.setAttribute("height", String(h + 16));
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "-8");
  bg.setAttribute("y", "-8");
  bg.setAttribute("width", String(w + 16));
  bg.setAttribute("height", String(h + 16));
  bg.setAttribute("fill", getComputedStyle(document.body).getPropertyValue("--surface") || "#fff");
  clone.insertBefore(bg, clone.firstChild);
  return { text: new XMLSerializer().serializeToString(clone), w: w + 16, h: h + 16 };
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvg(svg: SVGSVGElement, name: string) {
  download(`${name}.svg`, serialize(svg).text, "image/svg+xml");
}

export function exportPng(svg: SVGSVGElement, name: string, scale = 3) {
  const { text, w, h } = serialize(svg);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    c.toBlob((b) => b && download(`${name}.png`, b, "image/png"));
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
}

/** Card wrapper with a title, optional customisation panel and SVG/PNG export of the chart inside. */
export function ChartCard({ title, sub, actions, children, className, exportName, customize }: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  exportName?: string;
  customize?: { id: string; fields: OptionField[]; defaults?: OptionDefaults };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const opts = useChartOptions(customize?.id);
  const edited = Object.keys(opts).length > 0;
  const get = useCallback(() => ref.current?.querySelector(".chart svg") as SVGSVGElement | null, []);
  return (
    <section className={`card ${className ?? ""}`}>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {actions}
          <div className="chart-actions">
            {customize && (
              <button
                className={`btn ghost sm ${open ? "pressed" : ""}`} aria-expanded={open} title="Edit chart parameters"
                onClick={() => setOpen((v) => !v)}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
                Customize{edited ? " •" : ""}
              </button>
            )}
            {exportName && (
              <>
                <button className="btn ghost sm" title="Download SVG" onClick={() => { const s = get(); if (s) exportSvg(s, exportName); }}>SVG</button>
                <button className="btn ghost sm" title="Download PNG (3×)" onClick={() => { const s = get(); if (s) exportPng(s, exportName); }}>PNG</button>
              </>
            )}
          </div>
        </div>
      </div>
      {customize && open && <OptionsPanel id={customize.id} fields={customize.fields} defaults={customize.defaults} />}
      <div className="card-body" ref={ref}>{children}</div>
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string; shape?: number }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span className="legend-item" key={it.label}>
          {it.shape !== undefined ? (
            <svg width={12} height={12}><path d={shapePath(it.shape, 6, 6, 4.5)} fill={it.color} /></svg>
          ) : (
            <span className="swatch" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- labels

export interface LabelIn {
  x: number;
  y: number;
  text: string;
  /** preferred side */
  right: boolean;
}
export interface LabelOut extends LabelIn {
  lx: number;
  ly: number;
  anchor: "start" | "end";
}

/**
 * Greedy label placement: try the preferred side, then the other side, with
 * growing vertical offsets, avoiding earlier labels and staying inside bounds.
 * Labels that cannot be placed are dropped rather than drawn on top of others.
 */
export function placeLabels(
  items: LabelIn[],
  bounds: { x0: number; x1: number; y0: number; y1: number },
  obstacles: { x: number; y: number }[] = [],
  markR = 5,
  charW = 6.3,
  h = 13,
): LabelOut[] {
  const boxes: [number, number, number, number][] = obstacles.map((o) => [o.x - markR, o.y - markR, o.x + markR, o.y + markR]);
  const out: LabelOut[] = [];
  const hit = (a: number, b: number, c: number, d: number) => boxes.some(([p, q, r, s]) => a < r + 2 && c > p - 2 && b < s && d > q);
  for (const it of items) {
    const w = it.text.length * charW;
    let placed: LabelOut | null = null;
    for (let k = 0; k < 14 && !placed; k++) {
      const dy = k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (h - 1);
      for (const right of [it.right, !it.right]) {
        const lx = right ? it.x + 8 : it.x - 8;
        const ly = it.y + dy;
        const bx = right ? lx : lx - w;
        if (bx < bounds.x0 || bx + w > bounds.x1 || ly - h / 2 < bounds.y0 || ly + h / 2 > bounds.y1) continue;
        if (hit(bx, ly - h / 2, bx + w, ly + h / 2)) continue;
        placed = { ...it, lx, ly, anchor: right ? "start" : "end" };
        boxes.push([bx, ly - h / 2, bx + w, ly + h / 2]);
        break;
      }
    }
    if (placed) out.push(placed);
  }
  return out;
}
