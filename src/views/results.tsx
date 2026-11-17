import { useMemo, useState } from "react";
import type { Analysis } from "../state";
import {
  ChartCard, Legend, TipRow, divergingRamp, download, fmt, fmtP, sequentialRamp, useThemeVersion,
} from "../charts/core";
import { BarChart, BoxPlot, DensityChart, DotPlot, GradientLegend, Heatmap, MissingMap, Scatter, Volcano, type VolcanoPoint } from "../charts/charts";
import { correlation, cvByCondition, euclidean, hclust, pca } from "../lib/pipeline";
import { finiteSorted, median } from "../lib/stats";
import { DataTable, Icon, Seg, type Column } from "../components/ui";
import { SOURCE_LABEL } from "../lib/parse";

const firstGene = (g: string) => g.split(/[;,\s]/)[0];

// ================================================================ QC

export function QCView({ a }: { a: Analysis }) {
  const proc = a.proc!;
  const ds = a.dataset!;
  const dark = useThemeVersion();
  const [dist, setDist] = useState<"raw" | "norm">("norm");
  const labels = proc.samples.map((s) => s.label);
  const colors = proc.samples.map((s) => a.condColor(s.condition));
  const nS = proc.samples.length;
  const nP = proc.rows.length;

  const ids = useMemo(() => {
    const qt = ds.quantTypes.find((q) => q.key === a.params.quantKey) ?? ds.quantTypes[0];
    const idx = a.annotation.map((x, i) => ({ x, i })).filter(({ x }) => x.include).map(({ i }) => i);
    return idx.map((i) => {
      let n = 0;
      const v = qt.values[i];
      for (let r = 0; r < v.length; r++) if (Number.isFinite(v[r]) && (qt.isLog2 || v[r] > 0) && !(a.params.removeContaminants && ds.contaminant[r])) n++;
      return n;
    });
  }, [ds, a.annotation, a.params.quantKey, a.params.removeContaminants]);

  const coverage = useMemo(() => {
    const c = new Array(nS + 1).fill(0);
    for (let r = 0; r < nP; r++) {
      let n = 0;
      for (const col of proc.normalized) if (Number.isFinite(col[r])) n++;
      c[n]++;
    }
    return c;
  }, [proc, nS, nP]);

  const missingPct = useMemo(() => {
    let miss = 0;
    for (const col of proc.normalized) for (const v of col) if (!Number.isFinite(v)) miss++;
    return (100 * miss) / Math.max(1, nS * nP);
  }, [proc, nS, nP]);

  const corr = useMemo(() => {
    const M = proc.imputed;
    const c = M.map((x) => M.map((y) => correlation(x, y)));
    const { order, tree } = hclust(c.map((r) => r.map((v) => 1 - (Number.isFinite(v) ? v : 0))));
    let lo = 1;
    for (const r of c) for (const v of r) if (Number.isFinite(v) && v < lo) lo = v;
    return { c, order, tree, lo: Math.min(lo, 0.999) };
  }, [proc]);

  const cvs = useMemo(() => cvByCondition(proc), [proc]);
  const present = useMemo(() => {
    // proteins with at least one missing value, sorted by number missing
    const idx: number[] = [];
    for (let r = 0; r < nP; r++) if (proc.normalized.some((c) => !Number.isFinite(c[r]))) idx.push(r);
    const miss = (r: number) => proc.normalized.reduce((s, c) => s + (Number.isFinite(c[r]) ? 0 : 1), 0);
    idx.sort((x, y) => miss(x) - miss(y));
    return { cols: proc.normalized.map((c) => Uint8Array.from(idx, (r) => (Number.isFinite(c[r]) ? 1 : 0))), n: idx.length };
  }, [proc, nP]);

  const imputedVals = useMemo(() => {
    const obs: number[] = [];
    const imp: number[] = [];
    proc.imputed.forEach((c, j) => c.forEach((v, r) => (proc.imputedMask[j][r] ? imp : obs).push(v)));
    return { obs, imp };
  }, [proc]);

  const nSig = useMemo(() => {
    const any = new Uint8Array(nP);
    for (const res of a.results) res.significant.forEach((s, i) => s && (any[i] = 1));
    return any.reduce((x, y) => x + y, 0);
  }, [a.results, nP]);

  const seqRamp = sequentialRamp(dark);
  const condLegend = a.conditions.map((c) => ({ label: c, color: a.condColor(c) }));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Quality control</h2>
          <p>{ds.name} · {SOURCE_LABEL[ds.source]} · {nS} samples in {proc.conditions.length} conditions</p>
        </div>
      </div>
      <div className="tiles">
        <div className="tile card"><div className="k">Proteins analysed</div><div className="v">{nP.toLocaleString()}</div><div className="d">of {ds.ids.length.toLocaleString()} in file</div></div>
        <div className="tile card"><div className="k">Median IDs / sample</div><div className="v">{Math.round(median(ids)).toLocaleString()}</div><div className="d">range {Math.min(...ids).toLocaleString()}–{Math.max(...ids).toLocaleString()}</div></div>
        <div className="tile card"><div className="k">Missing values</div><div className="v">{missingPct.toFixed(1)}%</div><div className="d">{a.params.imputation === "none" ? "not imputed" : `imputed (${a.params.imputation})`}</div></div>
        <div className="tile card"><div className="k">Significant (any comparison)</div><div className="v">{nSig.toLocaleString()}</div><div className="d">{a.params.useAdjusted ? "adj. " : ""}p &lt; {a.params.alpha}, |log₂FC| ≥ {a.params.lfc}</div></div>
      </div>

      <div className="grid grid-2">
        <ChartCard title="Proteins per sample" sub="Quantified proteins before missing-value filtering" exportName="proteins_per_sample" className="span-all">
          <BarChart
            yTitle="Proteins"
            bars={proc.samples.map((s, i) => ({
              label: s.label, value: ids[i], color: a.condColor(s.condition),
              tip: <><div className="tt-title">{s.label}</div><TipRow k="Condition" v={s.condition} /><TipRow k="Proteins" v={ids[i].toLocaleString()} /></>,
            }))}
          />
          <Legend items={condLegend} />
        </ChartCard>

        <ChartCard
          title="Intensity distributions"
          sub={dist === "raw" ? "log₂ intensities before normalisation" : `After ${a.params.normalization} normalisation`}
          exportName="intensity_distributions"
          actions={<Seg value={dist} onChange={setDist} options={[{ value: "raw", label: "Before" }, { value: "norm", label: "After" }]} />}
        >
          <BoxPlot yTitle="log₂ intensity" series={(dist === "raw" ? proc.log2Raw : proc.normalized).map((c, j) => ({ label: labels[j], color: colors[j], values: finiteSorted(c) }))} />
        </ChartCard>

        <ChartCard title="Protein coverage" sub="Number of samples in which each protein is quantified" exportName="protein_coverage">
          <BarChart
            yTitle="Proteins"
            bars={coverage.slice(1).map((n, i) => ({ label: String(i + 1), value: n, color: "var(--series-1)", tip: <><div className="tt-title">Quantified in {i + 1} sample{i ? "s" : ""}</div><TipRow k="Proteins" v={n.toLocaleString()} /></> }))}
          />
        </ChartCard>

        <ChartCard title="Sample correlation" sub="Pearson correlation of log₂ intensities, clustered" exportName="sample_correlation">
          <Heatmap
            values={corr.c} rowLabels={labels} colLabels={labels} colColors={colors}
            rowOrder={corr.order} colOrder={corr.order} colTree={corr.tree} square
            color={(v) => seqRamp((v - corr.lo) / (1 - corr.lo))}
            cellTip={(r, c) => <><div className="tt-title">{labels[r]} × {labels[c]}</div><TipRow k="Pearson r" v={fmt(corr.c[r][c], 3)} /></>}
            legend={<GradientLegend color={seqRamp} min={corr.lo} max={1} label="r" />}
          />
        </ChartCard>

        <ChartCard title="Coefficient of variation" sub="Per condition, on linear intensities; lower is more reproducible" exportName="cv">
          <BoxPlot yTitle="CV (%)" series={cvs.map((c) => ({ label: c.condition, color: a.condColor(c.condition), values: finiteSorted(c.cvs) }))} />
          <div className="small muted">Median CV: {cvs.map((c) => `${c.condition} ${c.cvs.length ? median(c.cvs).toFixed(1) : "–"}%`).join(" · ")}</div>
        </ChartCard>

        <ChartCard title="Missing-value pattern" sub={`${present.n.toLocaleString()} proteins with ≥1 missing value (blue = quantified)`} exportName="missing_values">
          {present.n ? <MissingMap present={present.cols} colLabels={labels} colColors={colors} /> : <div className="empty">No missing values 🎉</div>}
        </ChartCard>

        {a.params.imputation !== "none" && imputedVals.imp.length > 0 && (
          <ChartCard title="Imputation" sub="Distribution of observed vs imputed values" exportName="imputation">
            <DensityChart xTitle="log₂ intensity" series={[{ label: "Observed", color: "var(--series-1)", values: imputedVals.obs }, { label: "Imputed", color: "var(--imputed)", values: imputedVals.imp, dashed: true }]} />
            <Legend items={[{ label: `Observed (${imputedVals.obs.length.toLocaleString()})`, color: "var(--series-1)" }, { label: `Imputed (${imputedVals.imp.length.toLocaleString()})`, color: "var(--imputed)" }]} />
          </ChartCard>
        )}
      </div>
    </>
  );
}

// ================================================================ PCA

export function PCAView({ a }: { a: Analysis }) {
  const proc = a.proc!;
  const [top, setTop] = useState<"0" | "500" | "1000">("500");
  const [pcx, setPcx] = useState(0);
  const [pcy, setPcy] = useState(1);
  const [labels, setLabels] = useState(true);
  const res = useMemo(() => pca(proc.imputed, Number(top)), [proc, top]);
  const nPC = res.scores.length;
  if (nPC < 2) return <div className="empty">PCA needs at least three samples with complete data.</div>;
  const x = Math.min(pcx, nPC - 1), y = Math.min(pcy, nPC - 1);
  const pct = (i: number) => `${(100 * res.explained[i]).toFixed(1)}%`;
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Principal component analysis</h2>
          <p>Sample-level structure on {res.nFeatures.toLocaleString()} {a.params.imputation === "none" ? "complete" : "(imputed)"} proteins{top !== "0" ? `, the ${top} most variable` : ""}.</p>
        </div>
      </div>
      <div className="split">
        <ChartCard
          title={`PC${x + 1} vs PC${y + 1}`}
          exportName={`pca_PC${x + 1}_PC${y + 1}`}
          actions={
            <div className="row">
              <select className="select sm" style={{ width: "auto" }} value={x} onChange={(e) => setPcx(+e.target.value)} aria-label="X axis component">{res.scores.map((_, i) => <option key={i} value={i}>PC{i + 1}</option>)}</select>
              <select className="select sm" style={{ width: "auto" }} value={y} onChange={(e) => setPcy(+e.target.value)} aria-label="Y axis component">{res.scores.map((_, i) => <option key={i} value={i}>PC{i + 1}</option>)}</select>
              <label className="check small"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels</label>
            </div>
          }
        >
          <Scatter
            xTitle={`PC${x + 1} (${pct(x)})`} yTitle={`PC${y + 1} (${pct(y)})`} showLabels={labels}
            points={proc.samples.map((s, j) => ({
              x: res.scores[x][j], y: res.scores[y][j], label: s.label,
              color: a.condColor(s.condition), shape: a.condShape(s.condition),
              tip: <><div className="tt-title">{s.label}</div><TipRow k="Condition" v={s.condition} /><TipRow k={`PC${x + 1}`} v={fmt(res.scores[x][j])} /><TipRow k={`PC${y + 1}`} v={fmt(res.scores[y][j])} /></>,
            }))}
          />
          <Legend items={a.conditions.map((c) => ({ label: c, color: a.condColor(c), shape: a.condShape(c) }))} />
        </ChartCard>
        <div className="grid">
          <ChartCard title="Features" sub="Proteins used for PCA">
            <Seg value={top} onChange={setTop} options={[{ value: "500", label: "Top 500 variable" }, { value: "1000", label: "Top 1000" }, { value: "0", label: "All" }]} />
          </ChartCard>
          <ChartCard title="Variance explained" exportName="pca_scree">
            <BarChart height={220} yTitle="% variance" bars={res.explained.map((v, i) => ({ label: `PC${i + 1}`, value: +(100 * v).toFixed(2), color: i === x || i === y ? "var(--series-1)" : "var(--ns)" }))} />
          </ChartCard>
        </div>
      </div>
    </>
  );
}

// ================================================================ differential

interface DERow {
  i: number; // row position in proc
  gene: string;
  id: string;
  desc: string;
  logFC: number;
  p: number;
  adjP: number;
  t: number;
  aveExpr: number;
  sig: number;
}

export function sendToEnrichr(genes: string[], description: string) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "https://maayanlab.cloud/Enrichr/enrich";
  form.target = "_blank";
  form.enctype = "multipart/form-data";
  for (const [k, v] of [["list", genes.join("\n")], ["description", description]]) {
    const inp = document.createElement("input");
    inp.type = "hidden";
    inp.name = k;
    inp.value = v;
    form.appendChild(inp);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export function DEView({ a }: { a: Analysis }) {
  const proc = a.proc!;
  const ds = a.dataset!;
  const [ci, setCi] = useState(0);
  const [query, setQuery] = useState("");
  const [onlySig, setOnlySig] = useState(false);
  const [nLabels, setNLabels] = useState(10);
  const res = a.results[Math.min(ci, a.results.length - 1)];

  const rows = useMemo<DERow[]>(() => {
    if (!res) return [];
    const ga = proc.conditions.indexOf(res.a), gb = proc.conditions.indexOf(res.b);
    return proc.rows.map((r, i) => {
      const x = res.rows[i];
      let s = 0, n = 0;
      proc.imputed.forEach((c, j) => { if ((proc.groupOf[j] === ga || proc.groupOf[j] === gb) && Number.isFinite(c[i])) { s += c[i]; n++; } });
      return {
        i, gene: ds.genes[r], id: ds.ids[r], desc: ds.descriptions[r] ?? "",
        logFC: x?.logFC ?? NaN, p: x?.p ?? NaN, adjP: x?.adjP ?? NaN, t: x?.t ?? NaN,
        aveExpr: n ? s / n : NaN, sig: res.significant[i] ? (x!.logFC > 0 ? 1 : -1) : 0,
      };
    });
  }, [res, proc, ds]);

  const terms = query.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const matches = useMemo(() => new Set(terms.length ? rows.filter((r) => terms.some((t) => r.gene.toLowerCase() === t || r.id.toLowerCase() === t || (t.length > 2 && r.gene.toLowerCase().startsWith(t)))).map((r) => r.i) : []), [rows, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPos = a.selected !== null ? proc.rows.indexOf(a.selected) : -1;
  const points = useMemo<VolcanoPoint[]>(() => rows.filter((r) => Number.isFinite(r.p)).map((r) => ({ x: r.logFC, y: -Math.log10(Math.max(r.p, 1e-300)), cls: r.sig as 0 | 1 | -1, label: firstGene(r.gene), idx: r.i })), [rows]);

  // With BH the effective p cutoff is the largest raw p still called significant.
  const pLine = useMemo(() => {
    if (!a.params.useAdjusted) return -Math.log10(a.params.alpha);
    let maxP = -1;
    for (const r of rows) if (r.adjP < a.params.alpha && r.p > maxP) maxP = r.p;
    return maxP > 0 ? -Math.log10(maxP) : null;
  }, [rows, a.params]);

  if (!res) return <div className="empty">Define at least one comparison under Processing.</div>;

  const tableRows = rows.filter((r) => (!onlySig || r.sig !== 0) && (!terms.length || matches.has(r.i)) && Number.isFinite(r.p));
  const sigGenes = (dir: 1 | -1 | 0) => [...new Set(rows.filter((r) => (dir === 0 ? r.sig !== 0 : r.sig === dir)).map((r) => firstGene(r.gene)).filter((g) => g && !/^DEMO\d/.test(g)))];

  const exportCsv = () => {
    const head = ["protein_id", "gene", "description", "log2FC", "t", "p_value", "adj_p_value", "significant", "average_log2_intensity"];
    const lines = rows.map((r) => [r.id, r.gene, `"${r.desc.replace(/"/g, '""')}"`, r.logFC, r.t, r.p, r.adjP, r.sig === 1 ? "up" : r.sig === -1 ? "down" : "", r.aveExpr].join("\t"));
    download(`DE_${res.a}_vs_${res.b}.tsv`, [head.join("\t"), ...lines].join("\n"), "text/tab-separated-values");
  };

  const columns: Column<DERow>[] = [
    { key: "gene", label: "Gene", value: (r) => r.gene, render: (r) => <b>{r.gene}</b> },
    { key: "id", label: "Protein", value: (r) => r.id, className: "mono" },
    { key: "logFC", label: "log₂FC", value: (r) => r.logFC, numeric: true, render: (r) => <span className={r.sig === 1 ? "up-text" : r.sig === -1 ? "down-text" : ""}>{fmt(r.logFC)}</span> },
    { key: "p", label: "p", value: (r) => r.p, numeric: true, render: (r) => fmtP(r.p) },
    { key: "adjP", label: "adj. p", value: (r) => r.adjP, numeric: true, render: (r) => fmtP(r.adjP) },
    { key: "desc", label: "Description", value: (r) => r.desc, className: "trunc muted" },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Differential expression</h2>
          <p>{a.params.test === "limma" ? "Empirical-Bayes moderated t-test (limma-style)" : "Pooled-variance t-test"}, {a.params.useAdjusted ? "Benjamini–Hochberg adjusted" : "unadjusted"} p &lt; {a.params.alpha}, |log₂FC| ≥ {a.params.lfc}.</p>
        </div>
      </div>

      <div className="row">
        {a.results.map((r, i) => (
          <button key={r.name} className={`chip ${i === ci ? "on" : ""}`} onClick={() => setCi(i)}>
            {r.name} <span className="up-text">▲{r.nUp}</span> <span className="down-text">▼{r.nDown}</span>
          </button>
        ))}
      </div>

      <div className="split">
        <ChartCard
          title={`${res.a} vs ${res.b}`}
          sub={<>{res.nUp} up · {res.nDown} down · {a.params.test === "limma" && Number.isFinite(res.prior.df2) ? `prior df ${res.prior.df2.toFixed(1)}` : ""}</>}
          exportName={`volcano_${res.a}_vs_${res.b}`}
          actions={
            <label className="small muted row" style={{ gap: 6 }}>
              Labels
              <select className="select sm" style={{ width: "auto" }} value={nLabels} onChange={(e) => setNLabels(+e.target.value)}>
                {[0, 5, 10, 20, 40].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          }
        >
          <Volcano
            points={points} lfc={a.params.lfc} pLine={pLine} highlight={matches}
            selected={selectedPos >= 0 ? selectedPos : null}
            onSelect={(i) => a.setSelected(proc.rows[i])}
            nLabels={nLabels} yTitle="−log₁₀ p"
          />
          <Legend items={[{ label: `Up in ${res.a}`, color: "var(--up)" }, { label: `Up in ${res.b}`, color: "var(--down)" }, { label: "Not significant", color: "var(--ns)" }]} />
        </ChartCard>

        <section className="card">
          <div className="card-head">
            <div className="row" style={{ flex: 1 }}>
              <div className="row" style={{ gap: 6, flex: 1, minWidth: 180, border: "1px solid var(--border-strong)", borderRadius: 8, padding: "4px 10px" }}>
                <span className="muted">{Icon.search()}</span>
                <input style={{ border: 0, outline: 0, background: "transparent", flex: 1, minWidth: 0 }} placeholder="Find genes (e.g. ISG15, MX1)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search genes" />
              </div>
              <label className="check small"><input type="checkbox" checked={onlySig} onChange={(e) => setOnlySig(e.target.checked)} /> Significant only</label>
            </div>
          </div>
          <div className="card-body">
            <DataTable
              rows={tableRows} columns={columns} rowKey={(r) => r.i} pageSize={15}
              initialSort={{ key: "p", dir: 1 }}
              onRowClick={(r) => a.setSelected(proc.rows[r.i])}
              rowClass={(r) => (r.i === selectedPos ? "sel" : "")}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn sm" onClick={exportCsv}>{Icon.download(14)} Table (TSV)</button>
              <span className="spacer" />
              <span className="small muted">Enrichr:</span>
              <button className="btn sm" disabled={!sigGenes(1).length} onClick={() => sendToEnrichr(sigGenes(1), `Up in ${res.a} vs ${res.b}`)}>Up ({sigGenes(1).length}) {Icon.external()}</button>
              <button className="btn sm" disabled={!sigGenes(-1).length} onClick={() => sendToEnrichr(sigGenes(-1), `Down in ${res.a} vs ${res.b}`)}>Down ({sigGenes(-1).length}) {Icon.external()}</button>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>Enrichr buttons send only the gene symbols to maayanlab.cloud, in a new tab.</div>
          </div>
        </section>
      </div>
    </>
  );
}

// ================================================================ heatmap

export function HeatmapView({ a }: { a: Analysis }) {
  const proc = a.proc!;
  const ds = a.dataset!;
  const dark = useThemeVersion();
  const [source, setSource] = useState<string>("any");
  const [maxRows, setMaxRows] = useState(100);
  const [clusterCols, setClusterCols] = useState(true);

  const data = useMemo(() => {
    const nP = proc.rows.length;
    let cand: { i: number; score: number }[] = [];
    if (source === "variable") {
      for (let i = 0; i < nP; i++) {
        const v = proc.imputed.map((c) => c[i]).filter(Number.isFinite);
        if (v.length < 2) continue;
        const mu = v.reduce((s, x) => s + x, 0) / v.length;
        cand.push({ i, score: -v.reduce((s, x) => s + (x - mu) ** 2, 0) });
      }
    } else {
      const which = source === "any" ? a.results : a.results.filter((r) => r.name === source);
      for (let i = 0; i < nP; i++) {
        let best = Infinity;
        for (const r of which) if (r.significant[i]) best = Math.min(best, r.rows[i]!.p);
        if (best < Infinity) cand.push({ i, score: best });
      }
    }
    cand.sort((x, y) => x.score - y.score);
    const total = cand.length;
    cand = cand.slice(0, maxRows);
    const z = cand.map(({ i }) => {
      const v = proc.imputed.map((c) => c[i]);
      const f = v.filter(Number.isFinite);
      const mu = f.reduce((s, x) => s + x, 0) / f.length;
      const sdv = Math.sqrt(f.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, f.length - 1)) || 1;
      return v.map((x) => (x - mu) / sdv);
    });
    const rowC = hclust(z.map((x) => z.map((y) => euclidean(x, y))));
    const nS = proc.samples.length;
    const cols = Array.from({ length: nS }, (_, j) => z.map((r) => r[j]));
    const colC = clusterCols ? hclust(cols.map((x) => cols.map((y) => euclidean(x, y)))) : { order: Array.from({ length: nS }, (_, j) => j), tree: undefined };
    return { z, rows: cand.map((c) => c.i), rowC, colC, total };
  }, [proc, a.results, source, maxRows, clusterCols]);

  const div = divergingRamp(dark);
  const lim = 2.5;
  const color = (v: number) => div((Math.max(-lim, Math.min(lim, v)) + lim) / (2 * lim));
  const labels = proc.samples.map((s) => s.label);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Heatmap</h2>
          <p>Row-wise z-scores of log₂ intensities, hierarchically clustered (average linkage, Euclidean). Click a row to inspect the protein.</p>
        </div>
      </div>
      <section className="card">
        <div className="card-body row">
          <label className="small row" style={{ gap: 6 }}>Proteins
            <select className="select sm" style={{ width: "auto" }} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="any">Significant in any comparison</option>
              {a.results.map((r) => <option key={r.name} value={r.name}>Significant: {r.name}</option>)}
              <option value="variable">Most variable</option>
            </select>
          </label>
          <label className="small row" style={{ gap: 6 }}>Show top
            <select className="select sm" style={{ width: "auto" }} value={maxRows} onChange={(e) => setMaxRows(+e.target.value)}>
              {[50, 100, 200, 300, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="check small"><input type="checkbox" checked={clusterCols} onChange={(e) => setClusterCols(e.target.checked)} /> Cluster samples</label>
          <span className="muted small">{data.total.toLocaleString()} candidates{data.total > maxRows ? `, showing ${maxRows} with the lowest p` : ""}</span>
        </div>
      </section>
      <ChartCard title="Clustered heatmap" exportName="heatmap">
        {data.rows.length < 2 ? (
          <div className="empty">Not enough proteins. Try “Most variable” or relax the significance cutoffs.</div>
        ) : (
          <Heatmap
            values={data.z}
            rowLabels={data.rows.map((i) => firstGene(ds.genes[proc.rows[i]]))}
            colLabels={labels}
            colColors={proc.samples.map((s) => a.condColor(s.condition))}
            rowOrder={data.rowC.order} colOrder={data.colC.order}
            rowTree={data.rowC.tree} colTree={data.colC.tree}
            color={color}
            height={Math.max(420, Math.min(1400, data.rows.length * 14 + 200))}
            onRowClick={(r) => a.setSelected(proc.rows[data.rows[r]])}
            cellTip={(r, c) => {
              const i = data.rows[r];
              return <><div className="tt-title">{ds.genes[proc.rows[i]]}</div><TipRow k="Sample" v={labels[c]} /><TipRow k="z-score" v={fmt(data.z[r][c])} /><TipRow k="log₂ intensity" v={fmt(proc.imputed[c][i])} />{proc.imputedMask[c][i] ? <div className="muted small">Imputed value</div> : null}</>;
            }}
            legend={
              <div className="row" style={{ justifyContent: "space-between" }}>
                <GradientLegend color={div} min={-lim} max={lim} label="z-score" />
                <Legend items={a.conditions.map((c) => ({ label: c, color: a.condColor(c) }))} />
              </div>
            }
          />
        )}
      </ChartCard>
    </>
  );
}

// ================================================================ protein drawer

export function ProteinPanel({ a }: { a: Analysis }) {
  const proc = a.proc;
  const ds = a.dataset;
  if (!proc || !ds || a.selected === null) return null;
  const pos = proc.rows.indexOf(a.selected);
  const r = a.selected;
  const acc = ds.ids[r];
  const uniprot = /^[OPQ][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/.test(acc.split(/[;|]/)[0]) ? acc.split(/[;|]/)[0] : null;
  return (
    <aside className="drawer" role="dialog" aria-label="Protein details">
      <div className="card-head" style={{ paddingBottom: 8 }}>
        <div>
          <h3 style={{ fontSize: 18 }}>{ds.genes[r]}</h3>
          <div className="sub mono">{acc}</div>
        </div>
        <button className="icon-btn" onClick={() => a.setSelected(null)} aria-label="Close">{Icon.close(18)}</button>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {ds.descriptions[r] && <p className="muted">{ds.descriptions[r]}</p>}
        {uniprot && <a href={`https://www.uniprot.org/uniprotkb/${uniprot}/entry`} target="_blank" rel="noreferrer" className="small row" style={{ gap: 4 }}>UniProt {uniprot} {Icon.external()}</a>}
        {pos < 0 ? (
          <div className="notice">This protein was removed by the current filters.</div>
        ) : (
          <>
            <div>
              <div className="field-label" style={{ marginBottom: 4 }}>log₂ intensity by condition</div>
              <DotPlot
                yTitle="log₂ intensity"
                groups={proc.conditions.map((c, g) => ({
                  label: c, color: a.condColor(c), shape: a.condShape(c),
                  points: proc.samples.map((s, j) => ({ s, j })).filter(({ j }) => proc.groupOf[j] === g).map(({ s, j }) => ({ v: proc.imputed[j][pos], imputed: !!proc.imputedMask[j][pos], sample: s.label })),
                }))}
              />
              <div className="small muted">Hollow markers are imputed. The bar marks the condition mean.</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Comparison</th><th className="num-cell">log₂FC</th><th className="num-cell">p</th><th className="num-cell">adj. p</th></tr></thead>
                <tbody>
                  {a.results.map((res) => {
                    const x = res.rows[pos];
                    const sig = res.significant[pos];
                    return (
                      <tr key={res.name}>
                        <td>{res.name}</td>
                        <td className={`num-cell ${sig ? (x!.logFC > 0 ? "up-text" : "down-text") : ""}`}>{x ? fmt(x.logFC) : "–"}</td>
                        <td className="num-cell">{x ? fmtP(x.p) : "–"}</td>
                        <td className="num-cell">{x ? fmtP(x.adjP) : "–"}{sig ? " ★" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

// ================================================================ export

export function methodsText(a: Analysis): string {
  const p = a.params;
  const ds = a.dataset!;
  const proc = a.proc!;
  const qt = ds.quantTypes.find((q) => q.key === p.quantKey) ?? ds.quantTypes[0];
  const filt = p.missingMode === "total"
    ? `quantified in at least ${Math.round(p.minValid * 100)}% of samples`
    : `with at least ${p.minValid} valid values in ${p.missingMode === "any" ? "at least one" : "every"} condition`;
  const imp = {
    none: "Missing values were not imputed; models were fitted to observed values only.",
    perseus: `Missing values were imputed per sample from a down-shifted normal distribution (shift ${p.shift} SD, width ${p.width} SD; seed ${p.seed}).`,
    mindet: "Missing values were imputed with each sample's 1% quantile (MinDet).",
    knn: "Missing values were imputed from the 10 nearest-neighbour proteins (Euclidean distance).",
  }[p.imputation];
  const norm = { none: "No normalisation was applied.", median: "Intensities were median-centred per sample.", quantile: "Intensities were quantile-normalised." }[p.normalization];
  const test = p.test === "limma"
    ? "Differential abundance was assessed with a per-protein linear model of condition means and empirical-Bayes moderated t-statistics (limma-style variance shrinkage)"
    : "Differential abundance was assessed with pooled-variance two-sample t-tests";
  return [
    `Protein-level ${qt.label.toLowerCase()} values from ${SOURCE_LABEL[ds.source]} (${ds.ids.length.toLocaleString()} protein groups, ${proc.samples.length} samples, ${proc.conditions.length} conditions) were analysed with FragPipe Aux.`,
    `${p.removeContaminants ? "Contaminants were removed and p" : "P"}roteins ${filt} were retained (${proc.rows.length.toLocaleString()} proteins). ${qt.isLog2 ? "Values were already log2-transformed." : "Intensities were log2-transformed, with zeros treated as missing."} ${norm} ${imp}`,
    `${test} for the comparisons ${p.contrasts.map(([x, y]) => `${x} vs ${y}`).join(", ")}. P-values were ${p.useAdjusted ? "adjusted with the Benjamini–Hochberg procedure" : "not adjusted for multiple testing"}; proteins with ${p.useAdjusted ? "adjusted " : ""}p < ${p.alpha} and |log2 fold change| ≥ ${p.lfc} were considered significant.`,
  ].join("\n\n");
}

export function ExportView({ a }: { a: Analysis }) {
  const proc = a.proc!;
  const ds = a.dataset!;
  const labels = proc.samples.map((s) => s.label);
  const base = ds.name.replace(/\.[a-z]+$/i, "").replace(/[^\w.-]+/g, "_");
  const meta = (r: number) => [ds.ids[r], ds.genes[r], `"${(ds.descriptions[r] ?? "").replace(/"/g, '""')}"`];

  const results = () => {
    const head = ["protein_id", "gene", "description", ...a.results.flatMap((r) => [`${r.name} log2FC`, `${r.name} p`, `${r.name} adj_p`, `${r.name} significant`]), ...labels.map((l) => `${l} log2`)];
    const lines = proc.rows.map((r, i) => [
      ...meta(r),
      ...a.results.flatMap((res) => {
        const x = res.rows[i];
        return x ? [x.logFC, x.p, x.adjP, res.significant[i] ? (x.logFC > 0 ? "up" : "down") : ""] : ["", "", "", ""];
      }),
      ...proc.imputed.map((c) => (Number.isFinite(c[i]) ? c[i].toFixed(4) : "")),
    ].join("\t"));
    download(`${base}_results.tsv`, [head.join("\t"), ...lines].join("\n"), "text/tab-separated-values");
  };
  const matrix = (which: "normalized" | "imputed") => {
    const m = which === "normalized" ? proc.normalized : proc.imputed;
    const head = ["protein_id", "gene", "description", ...labels];
    const lines = proc.rows.map((r, i) => [...meta(r), ...m.map((c) => (Number.isFinite(c[i]) ? c[i].toFixed(4) : "NA"))].join("\t"));
    download(`${base}_${which}_log2.tsv`, [head.join("\t"), ...lines].join("\n"), "text/tab-separated-values");
  };
  const params = () =>
    download(`${base}_parameters.json`, JSON.stringify({ app: "FragPipe Aux", version: "0.1.0", date: new Date().toISOString(), input: { name: ds.name, source: ds.source }, parameters: a.params, annotation: a.annotation, steps: proc.steps }, null, 2), "application/json");
  const text = methodsText(a);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Export</h2>
          <p>Download tables, parameters and a ready-to-edit methods paragraph. Every chart also has SVG/PNG export in its header.</p>
        </div>
      </div>
      <div className="grid grid-3">
        <section className="card"><div className="card-head"><h3>Results table</h3></div><div className="card-body" style={{ display: "grid", gap: 10 }}>
          <p className="muted small">All comparisons side by side (log₂FC, p, adj. p, call) plus the per-sample log₂ values used for testing.</p>
          <button className="btn primary" onClick={results}>{Icon.download(16)} results.tsv</button>
        </div></section>
        <section className="card"><div className="card-head"><h3>Intensity matrices</h3></div><div className="card-body" style={{ display: "grid", gap: 10 }}>
          <p className="muted small">Filtered and normalised log₂ intensities, with or without imputed values.</p>
          <div className="row"><button className="btn" onClick={() => matrix("normalized")}>{Icon.download(16)} Normalised</button><button className="btn" onClick={() => matrix("imputed")}>{Icon.download(16)} Imputed</button></div>
        </div></section>
        <section className="card"><div className="card-head"><h3>Reproducibility</h3></div><div className="card-body" style={{ display: "grid", gap: 10 }}>
          <p className="muted small">Every parameter, the sample annotation and the filtering steps, as JSON.</p>
          <button className="btn" onClick={params}>{Icon.download(16)} parameters.json</button>
        </div></section>
      </div>
      <section className="card">
        <div className="card-head"><h3>Methods</h3><button className="btn sm" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button></div>
        <div className="card-body"><div className="methods">{text}</div></div>
      </section>
    </>
  );
}
