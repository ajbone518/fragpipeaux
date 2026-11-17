import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * User-editable presentation settings for a chart. Every field is optional:
 * undefined means "automatic", so charts keep their computed defaults.
 */
export interface ChartOptions {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** px; undefined = fit the card */
  width?: number;
  /** px */
  height?: number;
  /** base text size in px (default 11) */
  fontSize?: number;
  /** marker radius in px */
  pointSize?: number;
  /** horizontal gridlines (default on) */
  grid?: boolean;
  colorUp?: string;
  colorDown?: string;
  colorNs?: string;
  /** heatmap colour scale runs from −limit to +limit */
  colorLimit?: number;
  rowLabels?: "auto" | "show" | "hide";
}

export type OptionField =
  | "title" | "xLabel" | "yLabel" | "xRange" | "yRange" | "size" | "fontSize" | "pointSize"
  | "grid" | "volcanoColors" | "colorLimit" | "rowLabels" | "conditionColors";

/** What a chart shows when an option is left on automatic (used as placeholders). */
export interface OptionDefaults {
  xLabel?: string;
  yLabel?: string;
  height?: number;
  pointSize?: number;
  colorLimit?: number;
}

const STORAGE_KEY = "fpa-chart-options-v1";

interface Ctx {
  all: Record<string, ChartOptions>;
  set: (id: string, patch: Partial<ChartOptions>) => void;
  reset: (id: string) => void;
  conditions: string[];
  condColor: (c: string) => string;
  condOverrides: Record<string, string>;
  setCondColor: (c: string, color: string | null) => void;
}

const OptionsContext = createContext<Ctx | null>(null);

export function ChartOptionsProvider({ children, conditions, condColor, condOverrides, setCondColor }: {
  children: ReactNode;
  conditions: string[];
  condColor: (c: string) => string;
  condOverrides: Record<string, string>;
  setCondColor: (c: string, color: string | null) => void;
}) {
  const [all, setAll] = useState<Record<string, ChartOptions>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  }, [all]);

  const set = useCallback((id: string, patch: Partial<ChartOptions>) => {
    setAll((old) => {
      const next = { ...old[id], ...patch };
      // drop "automatic" entries so the stored object stays minimal
      for (const k of Object.keys(next) as (keyof ChartOptions)[]) {
        const v = next[k];
        if (v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) delete next[k];
      }
      return { ...old, [id]: next };
    });
  }, []);
  const reset = useCallback((id: string) => setAll((old) => {
    const next = { ...old };
    delete next[id];
    return next;
  }), []);

  const value = useMemo(() => ({ all, set, reset, conditions, condColor, condOverrides, setCondColor }), [all, set, reset, conditions, condColor, condOverrides, setCondColor]);
  return <OptionsContext.Provider value={value}>{children}</OptionsContext.Provider>;
}

const EMPTY: ChartOptions = {};

export function useChartOptions(id: string | undefined): ChartOptions {
  const ctx = useContext(OptionsContext);
  return (id && ctx?.all[id]) || EMPTY;
}

export function useOptionsContext() {
  return useContext(OptionsContext);
}

// ------------------------------------------------------------- layout helpers

/** Apply user axis limits on top of an automatic domain. */
export function domainWith(auto: [number, number], min?: number, max?: number): [number, number] {
  const lo = min ?? auto[0];
  const hi = max ?? auto[1];
  return hi > lo ? [lo, hi] : auto;
}

export interface Frame {
  /** svg width */
  W: number;
  /** svg height */
  H: number;
  /** text scale relative to the 11px default */
  k: number;
  /** vertical space reserved for the in-figure title */
  titleH: number;
  grid: boolean;
}

export function frame(o: ChartOptions, containerWidth: number, defaultHeight: number): Frame {
  const k = (o.fontSize ?? 11) / 11;
  return {
    W: o.width && o.width > 50 ? o.width : containerWidth,
    H: o.height && o.height > 80 ? o.height : defaultHeight,
    k,
    titleH: o.title ? Math.round(24 * k) : 0,
    grid: o.grid !== false,
  };
}

/** Left margin wide enough for tick labels (and the rotated axis title). */
export function leftMargin(tickLabels: string[], k: number, hasTitle: boolean): number {
  const w = Math.max(2, ...tickLabels.map((s) => s.length)) * 6.3 * k;
  return Math.ceil(w + 12 + (hasTitle ? 16 * k + 10 : 0));
}

export function ChartTitle({ text, W, k }: { text?: string; W: number; k: number }) {
  if (!text) return null;
  return <text className="chart-title" x={W / 2} y={16 * k} textAnchor="middle">{text}</text>;
}

/** CSS custom property carrying the chosen font size to the chart's text. */
export const fontStyle = (o: ChartOptions) => (o.fontSize ? ({ "--fs": `${o.fontSize}px` } as React.CSSProperties) : undefined);

// ------------------------------------------------------------- editor panel

function OptNumber({ value, onChange, placeholder, step = 1, label }: { value?: number; onChange: (v?: number) => void; placeholder?: string; step?: number; label: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="input sm" type="number" step={step} aria-label={label} placeholder={placeholder ?? "auto"}
      value={text ?? (value === undefined ? "" : String(value))}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === "") onChange(undefined);
        else if (Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value));
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** Resolve a CSS colour (possibly a var()) to #rrggbb for <input type=color>. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const probe = document.createElement("span");
  probe.style.color = color;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return "#888888";
  return "#" + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
}

function ColorField({ label, value, fallback, onChange }: { label: string; value?: string; fallback: string; onChange: (v?: string) => void }) {
  return (
    <label className="color-field">
      <input type="color" value={toHex(value ?? fallback)} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <span>{label}</span>
      {value && <button className="link-btn" onClick={(e) => { e.preventDefault(); onChange(undefined); }}>reset</button>}
    </label>
  );
}

export function OptionsPanel({ id, fields, defaults = {} }: { id: string; fields: OptionField[]; defaults?: OptionDefaults }) {
  const ctx = useContext(OptionsContext);
  if (!ctx) return null;
  const o = ctx.all[id] ?? {};
  const set = (p: Partial<ChartOptions>) => ctx.set(id, p);
  const has = (f: OptionField) => fields.includes(f);
  const changed = Object.keys(o).length > 0;

  return (
    <div className="options-panel">
      <div className="options-grid">
        {has("title") && (
          <div className="field span-2">
            <label>Figure title</label>
            <input className="input sm" value={o.title ?? ""} placeholder="none" onChange={(e) => set({ title: e.target.value || undefined })} />
          </div>
        )}
        {has("xLabel") && (
          <div className="field">
            <label>X-axis label</label>
            <input className="input sm" value={o.xLabel ?? ""} placeholder={defaults.xLabel ?? "auto"} onChange={(e) => set({ xLabel: e.target.value || undefined })} />
          </div>
        )}
        {has("yLabel") && (
          <div className="field">
            <label>Y-axis label</label>
            <input className="input sm" value={o.yLabel ?? ""} placeholder={defaults.yLabel ?? "auto"} onChange={(e) => set({ yLabel: e.target.value || undefined })} />
          </div>
        )}
        {has("xRange") && (
          <div className="field">
            <label>X range</label>
            <div className="range-pair">
              <OptNumber label="X minimum" value={o.xMin} onChange={(v) => set({ xMin: v })} placeholder="min" step={0.5} />
              <span className="muted">–</span>
              <OptNumber label="X maximum" value={o.xMax} onChange={(v) => set({ xMax: v })} placeholder="max" step={0.5} />
            </div>
          </div>
        )}
        {has("yRange") && (
          <div className="field">
            <label>Y range</label>
            <div className="range-pair">
              <OptNumber label="Y minimum" value={o.yMin} onChange={(v) => set({ yMin: v })} placeholder="min" step={0.5} />
              <span className="muted">–</span>
              <OptNumber label="Y maximum" value={o.yMax} onChange={(v) => set({ yMax: v })} placeholder="max" step={0.5} />
            </div>
          </div>
        )}
        {has("size") && (
          <div className="field">
            <label>Width × height (px)</label>
            <div className="range-pair">
              <OptNumber label="Width" value={o.width} onChange={(v) => set({ width: v })} placeholder="fit" step={10} />
              <span className="muted">×</span>
              <OptNumber label="Height" value={o.height} onChange={(v) => set({ height: v })} placeholder={defaults.height ? String(defaults.height) : "auto"} step={10} />
            </div>
          </div>
        )}
        {has("fontSize") && (
          <div className="field">
            <label>Font size · {o.fontSize ?? 11}px</label>
            <input type="range" min={8} max={22} step={1} value={o.fontSize ?? 11} onChange={(e) => set({ fontSize: Number(e.target.value) === 11 ? undefined : Number(e.target.value) })} />
          </div>
        )}
        {has("pointSize") && (
          <div className="field">
            <label>Point size · {o.pointSize ?? defaults.pointSize ?? "auto"}</label>
            <input type="range" min={1} max={14} step={0.5} value={o.pointSize ?? defaults.pointSize ?? 4} onChange={(e) => set({ pointSize: Number(e.target.value) })} />
          </div>
        )}
        {has("colorLimit") && (
          <div className="field">
            <label>Colour scale limit (±)</label>
            <OptNumber label="Colour scale limit" value={o.colorLimit} onChange={(v) => set({ colorLimit: v !== undefined && v > 0 ? v : undefined })} placeholder={String(defaults.colorLimit ?? "auto")} step={0.5} />
          </div>
        )}
        {has("rowLabels") && (
          <div className="field">
            <label>Row labels</label>
            <select className="select sm" value={o.rowLabels ?? "auto"} onChange={(e) => set({ rowLabels: e.target.value === "auto" ? undefined : (e.target.value as "show" | "hide") })}>
              <option value="auto">Auto (≤ 90 rows)</option>
              <option value="show">Always</option>
              <option value="hide">Never</option>
            </select>
          </div>
        )}
        {has("grid") && (
          <div className="field">
            <label>Gridlines</label>
            <label className="check small"><input type="checkbox" checked={o.grid !== false} onChange={(e) => set({ grid: e.target.checked ? undefined : false })} /> Show</label>
          </div>
        )}
      </div>

      {has("volcanoColors") && (
        <div className="color-row">
          <span className="field-label">Colours</span>
          <ColorField label="Up" value={o.colorUp} fallback="var(--up)" onChange={(v) => set({ colorUp: v })} />
          <ColorField label="Down" value={o.colorDown} fallback="var(--down)" onChange={(v) => set({ colorDown: v })} />
          <ColorField label="Not significant" value={o.colorNs} fallback="var(--ns)" onChange={(v) => set({ colorNs: v })} />
        </div>
      )}
      {has("conditionColors") && ctx.conditions.length > 0 && (
        <div className="color-row">
          <span className="field-label">Condition colours <span className="muted">(all charts)</span></span>
          {ctx.conditions.map((c) => (
            <ColorField key={c} label={c} value={ctx.condOverrides[c]} fallback={ctx.condColor(c)} onChange={(v) => ctx.setCondColor(c, v ?? null)} />
          ))}
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
        <span className="muted small">Settings are saved in this browser and apply to exports.</span>
        <button className="btn sm" disabled={!changed} onClick={() => ctx.reset(id)}>Reset chart</button>
      </div>
    </div>
  );
}
