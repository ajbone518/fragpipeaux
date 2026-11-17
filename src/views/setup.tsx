import { useRef, useState } from "react";
import type { Analysis } from "../state";
import { SOURCE_LABEL } from "../lib/parse";
import { download } from "../charts/core";
import { Field, Icon, NumberInput, Seg, readFile } from "../components/ui";

// ---------------------------------------------------------------- data

export function DataView({ a, next }: { a: Analysis; next: () => void }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const annoInput = useRef<HTMLInputElement>(null);
  const [annoMsg, setAnnoMsg] = useState("");

  const handle = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const list = [...files];
    // Allow dropping the protein table and the annotation file together.
    const anno = list.find((f) => /annotation|manifest|\.fp-manifest/i.test(f.name));
    const main = list.find((f) => f !== anno) ?? list[0];
    const annoText = anno && anno !== main ? await readFile(anno) : undefined;
    setAnnoMsg(a.loadText(await readFile(main), main.name, annoText));
    setBusy(false);
  };

  const ds = a.dataset;
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Load data</h2>
          <p>Drop a FragPipe output table to start. Everything runs locally in your browser: no files are uploaded anywhere.</p>
        </div>
      </div>

      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
      >
        <div className="big-icon">{Icon.upload(24)}</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{busy ? "Reading…" : "Drop files here or click to browse"}</div>
          <div className="muted small">combined_protein.tsv · abundance_protein_*.tsv · report.pg_matrix.tsv · any CSV/TSV matrix</div>
          <div className="muted small">Tip: drop experiment_annotation.tsv together with the table to assign conditions automatically.</div>
        </div>
        <input ref={input} type="file" multiple accept=".tsv,.csv,.txt" hidden onChange={(e) => handle(e.target.files)} />
      </div>

      <div className="row">
        <button className="btn" onClick={a.loadDemo}>Try with demo data</button>
        <span className="muted small row" style={{ gap: 6 }}>{Icon.lock()} Private by design: data never leaves this tab.</span>
      </div>

      {a.error && <div className="notice">{a.error}</div>}
      {annoMsg && <div className="notice" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>{annoMsg}</div>}

      {ds && (
        <section className="card">
          <div className="card-head">
            <div>
              <h3>{ds.name}</h3>
              <div className="sub">{SOURCE_LABEL[ds.source]}</div>
            </div>
            <div className="row">
              <button className="btn ghost sm" onClick={() => annoInput.current?.click()}>Apply annotation file…</button>
              <input ref={annoInput} type="file" accept=".tsv,.csv,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setAnnoMsg(a.loadAnnotation(await readFile(f))); e.target.value = ""; }} />
              <button className="btn primary" onClick={next}>Continue to samples →</button>
            </div>
          </div>
          <div className="card-body">
            <div className="tiles">
              <div className="tile card"><div className="k">Proteins</div><div className="v">{ds.ids.length.toLocaleString()}</div><div className="d">{ds.contaminant.filter(Boolean).length} flagged contaminants</div></div>
              <div className="tile card"><div className="k">Samples</div><div className="v">{ds.samples.length}</div><div className="d">{a.conditions.length} condition{a.conditions.length === 1 ? "" : "s"} detected</div></div>
              <div className="tile card"><div className="k">Quantification</div><div className="v" style={{ fontSize: 18, paddingTop: 6 }}>{ds.quantTypes.map((q) => q.label).join(" · ")}</div></div>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h3>Supported inputs</h3></div>
        <div className="card-body">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Workflow</th><th>File</th><th>Notes</th></tr></thead>
              <tbody>
                <tr><td>LFQ (IonQuant / MaxLFQ)</td><td className="mono">combined_protein.tsv</td><td>MaxLFQ intensity, intensity or spectral counts; zeros treated as missing</td></tr>
                <tr><td>Isobaric (TMT / iTRAQ)</td><td className="mono">abundance_protein_*.tsv, ratio_protein_*.tsv</td><td>TMT-Integrator output; already log₂, not re-transformed</td></tr>
                <tr><td>DIA (DIA-NN in FragPipe)</td><td className="mono">report.pg_matrix.tsv</td><td>Run paths are shortened to file names</td></tr>
                <tr><td>Experiment design</td><td className="mono">experiment_annotation.tsv</td><td>Columns: file / sample / sample_name, condition, replicate</td></tr>
                <tr><td>Anything else</td><td className="mono">*.csv, *.tsv</td><td>First text column = protein ID; numeric columns = samples</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- samples

export function SamplesView({ a, next }: { a: Analysis; next: () => void }) {
  const annoInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const ds = a.dataset!;
  const update = (i: number, patch: Partial<(typeof a.annotation)[number]>) =>
    a.setAnnotation(a.annotation.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const counts = new Map<string, number>();
  a.annotation.forEach((x) => x.include && counts.set(x.condition, (counts.get(x.condition) ?? 0) + 1));
  const single = [...counts.entries()].filter(([, n]) => n < 2).map(([c]) => c);

  const template = () =>
    download(
      "experiment_annotation.tsv",
      ["file\tsample\tsample_name\tcondition\treplicate", ...a.annotation.map((x) => `\t${x.sample}\t${x.label}\t${x.condition}\t${x.replicate}`)].join("\n"),
      "text/tab-separated-values",
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Samples &amp; conditions</h2>
          <p>Conditions were inferred from sample names. Edit them here, or apply a FragPipe <span className="mono">experiment_annotation.tsv</span>. Untick a sample to exclude it.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => annoInput.current?.click()}>{Icon.upload(16)} Apply annotation</button>
          <input ref={annoInput} type="file" accept=".tsv,.csv,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setMsg(a.loadAnnotation(await readFile(f))); e.target.value = ""; }} />
          <button className="btn" onClick={template}>{Icon.download(16)} Template</button>
          <button className="btn primary" disabled={a.conditions.length < 2} onClick={next}>Continue →</button>
        </div>
      </div>

      {msg && <div className="notice" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>{msg}</div>}
      {a.conditions.length < 2 && <div className="notice">At least two conditions are needed for differential analysis. Give samples different condition names.</div>}
      {single.length > 0 && <div className="notice">Condition{single.length > 1 ? "s" : ""} with a single replicate: {single.join(", ")}. Variance can’t be estimated within {single.length > 1 ? "them" : "it"}; results rely on the other groups.</div>}

      <div className="row">
        {a.conditions.map((c) => (
          <span key={c} className="chip" style={{ cursor: "default" }}>
            <span className="swatch" style={{ background: a.condColor(c) }} /> {c} <span className="muted">· {counts.get(c)}</span>
          </span>
        ))}
      </div>

      <section className="card">
        <div className="card-body">
          <datalist id="conds">{a.conditions.map((c) => <option key={c} value={c} />)}</datalist>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Use</th>
                  <th>Column in file</th>
                  <th>Display label</th>
                  <th>Condition</th>
                  <th style={{ width: 90 }}>Replicate</th>
                  <th className="num-cell">Quantified</th>
                </tr>
              </thead>
              <tbody>
                {a.annotation.map((x, i) => {
                  const v = ds.quantTypes.find((q) => q.key === a.params.quantKey)?.values[i] ?? ds.quantTypes[0].values[i];
                  let n = 0;
                  for (const t of v) if (Number.isFinite(t) && (ds.quantTypes[0].isLog2 || t > 0)) n++;
                  return (
                    <tr key={x.sample} style={{ opacity: x.include ? 1 : 0.5 }}>
                      <td><input type="checkbox" className="check" checked={x.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Include ${x.sample}`} /></td>
                      <td className="mono">{x.sample}</td>
                      <td><input className="input sm" value={x.label} onChange={(e) => update(i, { label: e.target.value })} /></td>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <span className="swatch" style={{ background: a.condColor(x.condition) }} />
                          <input className="input sm" list="conds" value={x.condition} onChange={(e) => update(i, { condition: e.target.value })} />
                        </div>
                      </td>
                      <td><NumberInput className="sm" value={x.replicate} min={1} onChange={(v) => update(i, { replicate: v })} /></td>
                      <td className="num-cell">{n.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- processing

export function ProcessingView({ a, next }: { a: Analysis; next: () => void }) {
  const p = a.params;
  const ds = a.dataset!;
  const qt = ds.quantTypes.find((q) => q.key === p.quantKey) ?? ds.quantTypes[0];
  const steps = a.proc?.steps ?? [];
  const max = Math.max(1, ...steps.map((s) => s.proteins));
  const [newA, setNewA] = useState("");
  const [newB, setNewB] = useState("");
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Processing &amp; statistics</h2>
          <p>Every change re-runs the full pipeline instantly. Defaults follow common FragPipe-Analyst / DEP practice.</p>
        </div>
        <button className="btn primary" disabled={!a.results.length} onClick={next}>View results →</button>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h3>Quantification &amp; filtering</h3></div>
          <div className="card-body form-grid">
            {ds.quantTypes.length > 1 && (
              <Field label="Quantity">
                <select className="select" value={p.quantKey} onChange={(e) => a.setParams({ quantKey: e.target.value })}>
                  {ds.quantTypes.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
                </select>
              </Field>
            )}
            <Field label="Contaminants" hint="Entries prefixed contam_ / CON__">
              <label className="check"><input type="checkbox" checked={p.removeContaminants} onChange={(e) => a.setParams({ removeContaminants: e.target.checked })} /> Remove</label>
            </Field>
            {ds.peptides && (
              <Field label={ds.source === "fragpipe-tmt" ? "Min. PSMs" : "Min. peptides"}>
                <NumberInput value={p.minPeptides} min={0} onChange={(v) => a.setParams({ minPeptides: Math.round(v) })} />
              </Field>
            )}
            <Field label="Missing-value filter" hint={p.missingMode === "total" ? "Fraction of all samples with a value" : "Valid values required per condition"}>
              <select className="select" value={p.missingMode} onChange={(e) => {
                const m = e.target.value as typeof p.missingMode;
                a.setParams({ missingMode: m, minValid: m === "total" ? 0.5 : 2 });
              }}>
                <option value="any">In at least one condition</option>
                <option value="all">In every condition</option>
                <option value="total">Across all samples</option>
              </select>
            </Field>
            <Field label={p.missingMode === "total" ? "Min. fraction" : "Min. valid values"}>
              <NumberInput value={p.minValid} step={p.missingMode === "total" ? 0.05 : 1} min={0} max={p.missingMode === "total" ? 1 : 99} onChange={(v) => a.setParams({ minValid: v })} />
            </Field>
            <Field label="Transformation">
              <div className="muted small" style={{ paddingTop: 6 }}>{qt.isLog2 ? "Input already log₂: used as is" : "log₂ (zeros → missing)"}</div>
            </Field>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Normalisation &amp; imputation</h3></div>
          <div className="card-body form-grid">
            <Field label="Normalisation" hint={{ none: "Use values as they are", median: "Align sample medians (robust default)", quantile: "Force identical distributions" }[p.normalization]}>
              <Seg value={p.normalization} onChange={(v) => a.setParams({ normalization: v })} options={[{ value: "none", label: "None" }, { value: "median", label: "Median" }, { value: "quantile", label: "Quantile" }]} />
            </Field>
            <Field label="Imputation" hint={{
              none: "Keep missing values; the model uses observed values only",
              perseus: "Left-shifted Gaussian for low-abundance dropouts (MNAR)",
              mindet: "Each sample's 1% quantile (MNAR)",
              knn: "Nearest-neighbour proteins (MAR)",
            }[p.imputation]}>
              <select className="select" value={p.imputation} onChange={(e) => a.setParams({ imputation: e.target.value as typeof p.imputation })}>
                <option value="perseus">Perseus-style (shift / width)</option>
                <option value="mindet">MinDet</option>
                <option value="knn">k-nearest neighbours</option>
                <option value="none">None</option>
              </select>
            </Field>
            {p.imputation === "perseus" && (
              <>
                <Field label="Down-shift (SD)"><NumberInput value={p.shift} step={0.1} min={0} onChange={(v) => a.setParams({ shift: v })} /></Field>
                <Field label="Width (SD)"><NumberInput value={p.width} step={0.05} min={0.01} onChange={(v) => a.setParams({ width: v })} /></Field>
                <Field label="Random seed" hint="Fixed for reproducibility"><NumberInput value={p.seed} onChange={(v) => a.setParams({ seed: Math.round(v) })} /></Field>
              </>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Differential expression</h3></div>
          <div className="card-body form-grid">
            <Field label="Test" hint={p.test === "limma" ? "Empirical-Bayes moderated t (limma), recommended for small n" : "Ordinary pooled-variance t-test"}>
              <Seg value={p.test} onChange={(v) => a.setParams({ test: v })} options={[{ value: "limma", label: "limma" }, { value: "ttest", label: "t-test" }]} />
            </Field>
            <Field label={`${p.useAdjusted ? "Adjusted p" : "p-value"} cutoff`}>
              <NumberInput value={p.alpha} step={0.01} min={0} max={1} onChange={(v) => a.setParams({ alpha: v })} />
            </Field>
            <Field label="|log₂ FC| cutoff">
              <NumberInput value={p.lfc} step={0.1} min={0} onChange={(v) => a.setParams({ lfc: v })} />
            </Field>
            <Field label="Correction">
              <Seg value={p.useAdjusted ? "bh" : "raw"} onChange={(v) => a.setParams({ useAdjusted: v === "bh" })} options={[{ value: "bh", label: "Benjamini–Hochberg" }, { value: "raw", label: "None" }]} />
            </Field>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Comparisons</h3><div className="sub">log₂FC = first − second</div></div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Seg value={a.contrastMode} onChange={a.setContrastMode} options={[{ value: "control", label: "Versus control" }, { value: "pairwise", label: "All pairs" }, { value: "custom", label: "Custom" }]} />
            {a.contrastMode === "control" && (
              <Field label="Control condition">
                <select className="select" value={a.control} onChange={(e) => a.setControl(e.target.value)}>
                  {a.conditions.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            )}
            <div className="row">
              {p.contrasts.map(([x, y], i) => (
                <span key={`${x}-${y}`} className="chip on">
                  {x} vs {y}
                  {a.contrastMode === "custom" && (
                    <button className="icon-btn" style={{ padding: 0 }} aria-label="Remove comparison" onClick={() => a.setParams({ contrasts: p.contrasts.filter((_, j) => j !== i) })}>{Icon.close(12)}</button>
                  )}
                </span>
              ))}
              {!p.contrasts.length && <span className="muted small">No comparisons defined.</span>}
            </div>
            {a.contrastMode === "custom" && (
              <div className="row">
                <select className="select" style={{ width: "auto" }} value={newA} onChange={(e) => setNewA(e.target.value)}>
                  <option value="">Condition…</option>{a.conditions.map((c) => <option key={c}>{c}</option>)}
                </select>
                <span className="muted">vs</span>
                <select className="select" style={{ width: "auto" }} value={newB} onChange={(e) => setNewB(e.target.value)}>
                  <option value="">Reference…</option>{a.conditions.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button className="btn sm" disabled={!newA || !newB || newA === newB || p.contrasts.some(([x, y]) => x === newA && y === newB)} onClick={() => a.setParams({ contrasts: [...p.contrasts, [newA, newB]] })}>Add</button>
              </div>
            )}
          </div>
        </section>

        <section className="card span-all">
          <div className="card-head"><h3>Protein filtering</h3><div className="sub">Proteins remaining after each step</div></div>
          <div className="card-body funnel">
            {steps.map((s) => (
              <div className="funnel-row" key={s.label}>
                <span>{s.label}</span>
                <div className="funnel-bar" style={{ width: `${(100 * s.proteins) / max}%` }} />
                <span className="num-cell">{s.proteins.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
