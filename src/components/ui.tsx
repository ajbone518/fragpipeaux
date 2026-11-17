import { useMemo, useState, type ReactNode } from "react";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  upload: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>,
  table: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></svg>,
  sliders: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>,
  gauge: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></svg>,
  scatter: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M3 3v18h18" /><circle cx="8" cy="14" r="1.6" /><circle cx="12" cy="9" r="1.6" /><circle cx="17" cy="12" r="1.6" /><circle cx="15" cy="6" r="1.6" /></svg>,
  volcano: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M3 20h18M12 20V4" /><circle cx="6" cy="8" r="1.4" /><circle cx="18" cy="6" r="1.4" /><circle cx="8" cy="14" r="1.4" /><circle cx="16" cy="12" r="1.4" /><circle cx="11" cy="17" r="1.2" /><circle cx="13" cy="17" r="1.2" /></svg>,
  grid: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  download: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>,
  moon: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>,
  sun: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  close: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  lock: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  external: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>,
  search: (s = 15) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
};

export const Logo = () => (
  <svg width={18} height={18} viewBox="0 0 32 32">
    <circle cx="9" cy="22" r="3.2" fill="#fff" />
    <circle cx="16" cy="10" r="3.2" fill="#fff" />
    <circle cx="23" cy="18" r="3.2" fill="#fff" />
  </svg>
);

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function NumberInput({ value, onChange, step = 1, min, max, className }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className={`input ${className ?? ""}`}
      type="number"
      step={step}
      min={min}
      max={max}
      value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, v) : v) : v);
      }}
      onBlur={() => setText(null)}
    />
  );
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  value: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
  className?: string;
}

/** Sortable, paginated table. */
export function DataTable<T>({ rows, columns, pageSize = 25, initialSort, onRowClick, rowClass, rowKey }: {
  rows: T[];
  columns: Column<T>[];
  pageSize?: number;
  initialSort?: { key: string; dir: 1 | -1 };
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string;
  rowKey: (row: T) => string | number;
}) {
  const [sort, setSort] = useState(initialSort ?? { key: columns[0].key, dir: 1 as 1 | -1 });
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    return [...rows].sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      if (typeof va === "number" && typeof vb === "number") {
        const na = Number.isFinite(va), nb = Number.isFinite(vb);
        if (!na || !nb) return na === nb ? 0 : na ? -1 : 1; // NaN last
        return (va - vb) * sort.dir;
      }
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
  }, [rows, columns, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pg = Math.min(page, pages - 1);
  const view = sorted.slice(pg * pageSize, pg * pageSize + pageSize);
  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`sortable ${c.numeric ? "num-cell" : ""}`}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : c.numeric ? 1 : 1 }))}
                >
                  {c.label} {sort.key === c.key ? (sort.dir === 1 ? "↑" : "↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={rowKey(r)} className={`${onRowClick ? "clickable" : ""} ${rowClass?.(r) ?? ""}`} onClick={() => onRowClick?.(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.numeric ? "num-cell" : ""} ${c.className ?? ""}`}>
                    {c.render ? c.render(r) : c.value(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!view.length && (
              <tr><td colSpan={columns.length} className="muted" style={{ textAlign: "center", padding: 24 }}>No rows</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="row small muted" style={{ marginTop: 8, justifyContent: "flex-end" }}>
          <span>{(pg * pageSize + 1).toLocaleString()}–{Math.min(sorted.length, (pg + 1) * pageSize).toLocaleString()} of {sorted.length.toLocaleString()}</span>
          <button className="btn sm" disabled={pg === 0} onClick={() => setPage(0)}>«</button>
          <button className="btn sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹</button>
          <button className="btn sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>›</button>
          <button className="btn sm" disabled={pg >= pages - 1} onClick={() => setPage(pages - 1)}>»</button>
        </div>
      )}
    </div>
  );
}

export function readFile(file: File): Promise<string> {
  return file.text();
}
