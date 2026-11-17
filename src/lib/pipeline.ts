import type { Dataset, SampleAnno } from "./parse";
import { finiteSorted, mean, median, moderate, quantile, type ContrastFit, type Moderated, type TestRow } from "./stats";

/** Column-major matrix: cols[sample][protein]. NaN = missing. */
export type Matrix = Float64Array[];

export type Normalization = "none" | "median" | "quantile";
export type Imputation = "none" | "perseus" | "mindet" | "knn";
export type MissingFilterMode = "any" | "all" | "total";
export type Test = "limma" | "ttest";

export interface Params {
  quantKey: string;
  removeContaminants: boolean;
  minPeptides: number;
  missingMode: MissingFilterMode;
  /** "any"/"all": minimum valid values per condition; "total": fraction (0–1) of samples */
  minValid: number;
  normalization: Normalization;
  imputation: Imputation;
  shift: number;
  width: number;
  seed: number;
  test: Test;
  contrasts: [string, string][];
  alpha: number;
  lfc: number;
  useAdjusted: boolean;
}

export const defaultParams = (quantKey: string): Params => ({
  quantKey,
  removeContaminants: true,
  minPeptides: 0,
  missingMode: "any",
  minValid: 2,
  normalization: "median",
  imputation: "perseus",
  shift: 1.8,
  width: 0.3,
  seed: 42,
  test: "limma",
  contrasts: [],
  alpha: 0.05,
  lfc: 1,
  useAdjusted: true,
});

// ------------------------------------------------------------------ rng

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next, normal };
}

// ------------------------------------------------------------ processing

export interface Step {
  label: string;
  proteins: number;
}

export interface Processed {
  samples: SampleAnno[];
  conditions: string[];
  groupOf: number[]; // condition index per sample
  /** indices into the dataset's protein arrays */
  rows: number[];
  log2Raw: Matrix; // filtered, log2, before normalization
  normalized: Matrix; // filtered, normalized, with NaN
  imputed: Matrix; // after imputation (equals normalized if none)
  imputedMask: Uint8Array[]; // 1 where value was imputed
  steps: Step[];
}

const log2 = (x: number) => (x > 0 ? Math.log2(x) : NaN);

export function process(ds: Dataset, anno: SampleAnno[], p: Params): Processed {
  const qt = ds.quantTypes.find((q) => q.key === p.quantKey) ?? ds.quantTypes[0];
  const used = anno.map((a, i) => ({ a, i })).filter(({ a }) => a.include);
  const samples = used.map(({ a }) => a);
  const conditions = [...new Set(samples.map((s) => s.condition))];
  const groupOf = samples.map((s) => conditions.indexOf(s.condition));
  const nP = ds.ids.length;
  const steps: Step[] = [{ label: "Input", proteins: nP }];

  const allLog = used.map(({ i }) => {
    const v = qt.values[i];
    const out = new Float64Array(nP);
    for (let r = 0; r < nP; r++) out[r] = qt.isLog2 ? v[r] : log2(v[r]);
    return out;
  });

  let rows: number[] = [];
  for (let r = 0; r < nP; r++) {
    let any = false;
    for (const c of allLog) if (Number.isFinite(c[r])) { any = true; break; }
    if (any) rows.push(r);
  }
  steps.push({ label: "Quantified in ≥1 sample", proteins: rows.length });

  if (p.removeContaminants) {
    rows = rows.filter((r) => !ds.contaminant[r]);
    steps.push({ label: "Contaminants removed", proteins: rows.length });
  }
  if (p.minPeptides > 0 && ds.peptides) {
    rows = rows.filter((r) => (ds.peptides![r] ?? 0) >= p.minPeptides);
    steps.push({ label: `≥ ${p.minPeptides} peptides`, proteins: rows.length });
  }

  // Missing-value filter
  const G = conditions.length;
  const groupSize = conditions.map((_, g) => groupOf.filter((x) => x === g).length);
  rows = rows.filter((r) => {
    const counts = new Array(G).fill(0);
    allLog.forEach((c, j) => { if (Number.isFinite(c[r])) counts[groupOf[j]]++; });
    if (p.missingMode === "total") {
      const tot = counts.reduce((a, b) => a + b, 0);
      return tot >= Math.ceil(p.minValid * samples.length - 1e-9);
    }
    const ok = counts.map((n, g) => n >= Math.min(p.minValid, groupSize[g]));
    return p.missingMode === "any" ? ok.some(Boolean) : ok.every(Boolean);
  });
  steps.push({
    label:
      p.missingMode === "total"
        ? `Valid in ≥ ${Math.round(p.minValid * 100)}% of samples`
        : `≥ ${p.minValid} valid in ${p.missingMode === "any" ? "any" : "every"} condition`,
    proteins: rows.length,
  });

  const log2Raw = allLog.map((c) => Float64Array.from(rows, (r) => c[r]));
  const normalized = normalize(log2Raw, p.normalization);
  const { imputed, mask } = impute(normalized, groupOf, p);
  return { samples, conditions, groupOf, rows, log2Raw, normalized, imputed, imputedMask: mask, steps };
}

export function normalize(m: Matrix, method: Normalization): Matrix {
  if (method === "none") return m.map((c) => Float64Array.from(c));
  if (method === "median") {
    const meds = m.map((c) => median(finiteSorted(c)));
    const target = mean(meds);
    return m.map((c, j) => c.map((v) => v - meds[j] + target));
  }
  // Quantile normalisation tolerant of missing values: each sample's observed
  // values are mapped onto the mean quantile function by rank fraction.
  const sorted = m.map(finiteSorted);
  const n = Math.max(...sorted.map((s) => s.length));
  const ref = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (const col of sorted) s += quantile(col, n === 1 ? 0 : k / (n - 1));
    ref[k] = s / sorted.length;
  }
  return m.map((c) => {
    const idx: number[] = [];
    for (let i = 0; i < c.length; i++) if (Number.isFinite(c[i])) idx.push(i);
    idx.sort((a, b) => c[a] - c[b]);
    const out = new Float64Array(c.length).fill(NaN);
    // average ranks for ties
    let k = 0;
    while (k < idx.length) {
      let e = k;
      while (e + 1 < idx.length && c[idx[e + 1]] === c[idx[k]]) e++;
      const frac = idx.length === 1 ? 0 : (k + e) / 2 / (idx.length - 1);
      const v = quantile(ref, frac);
      for (let q = k; q <= e; q++) out[idx[q]] = v;
      k = e + 1;
    }
    return out;
  });
}

export function impute(m: Matrix, groupOf: number[], p: Pick<Params, "imputation" | "shift" | "width" | "seed">) {
  const mask = m.map((c) => new Uint8Array(c.length));
  const out = m.map((c) => Float64Array.from(c));
  if (p.imputation === "none") return { imputed: out, mask };
  const R = rng(p.seed);
  const nP = m[0]?.length ?? 0;

  if (p.imputation === "knn") {
    // MAR imputation: average of the k nearest proteins (Euclidean on shared
    // observed samples) that are observed in the missing sample. Falls back
    // to the protein's condition mean, then the sample's 1% quantile.
    knnImpute(m, out, mask, groupOf, 10);
    return { imputed: out, mask };
  }

  m.forEach((c, j) => {
    const s = finiteSorted(c);
    const mu = mean(s);
    let sdv = 0;
    for (const v of s) sdv += (v - mu) ** 2;
    sdv = Math.sqrt(sdv / Math.max(1, s.length - 1));
    const q01 = quantile(s, 0.01);
    for (let r = 0; r < nP; r++) {
      if (Number.isFinite(c[r])) continue;
      mask[j][r] = 1;
      out[j][r] =
        p.imputation === "perseus"
          ? mu - p.shift * sdv + p.width * sdv * R.normal()
          : q01; // MinDet
    }
  });
  return { imputed: out, mask };
}

function knnImpute(m: Matrix, out: Matrix, mask: Uint8Array[], groupOf: number[], k: number) {
  const nS = m.length;
  const nP = m[0]?.length ?? 0;
  const complete: number[] = [];
  for (let r = 0; r < nP; r++) {
    let ok = true;
    for (let j = 0; j < nS; j++) if (!Number.isFinite(m[j][r])) { ok = false; break; }
    if (ok) complete.push(r);
  }
  // Limit the candidate pool to keep this interactive on large tables.
  const maxPool = 1000;
  const stride = Math.ceil(complete.length / maxPool);
  const pool = stride > 1 ? complete.filter((_, i) => i % stride === 0) : complete;
  const q01 = m.map((c) => quantile(finiteSorted(c), 0.01));
  const bestD = new Float64Array(k);
  const bestQ = new Int32Array(k);
  for (let r = 0; r < nP; r++) {
    const missing: number[] = [];
    for (let j = 0; j < nS; j++) if (!Number.isFinite(m[j][r])) missing.push(j);
    if (!missing.length) continue;
    const obs: number[] = [];
    for (let j = 0; j < nS; j++) if (Number.isFinite(m[j][r])) obs.push(j);
    let nn: number[] = [];
    if (obs.length >= 2 && pool.length >= k) {
      // keep the k smallest distances with an insertion buffer (no full sort)
      bestD.fill(Infinity);
      for (const q of pool) {
        let s = 0;
        for (const j of obs) {
          const d = m[j][r] - m[j][q];
          s += d * d;
          if (s >= bestD[k - 1]) break;
        }
        if (s >= bestD[k - 1]) continue;
        let pos = k - 1;
        while (pos > 0 && bestD[pos - 1] > s) {
          bestD[pos] = bestD[pos - 1];
          bestQ[pos] = bestQ[pos - 1];
          pos--;
        }
        bestD[pos] = s;
        bestQ[pos] = q;
      }
      nn = Array.from(bestQ);
    }
    for (const j of missing) {
      let v: number;
      if (nn.length) {
        // shift neighbours to the protein's level on observed samples
        let off = 0;
        for (const q of nn) for (const o of obs) off += m[o][r] - m[o][q];
        off /= nn.length * obs.length;
        v = nn.reduce((s, q) => s + m[j][q], 0) / nn.length + off;
      } else {
        const same = obs.filter((o) => groupOf[o] === groupOf[j]);
        v = same.length ? same.reduce((s, o) => s + m[o][r], 0) / same.length : q01[j];
      }
      out[j][r] = v;
      mask[j][r] = 1;
    }
  }
}

// ----------------------------------------------------- differential testing

export interface ContrastResult {
  name: string;
  a: string;
  b: string;
  rows: (TestRow | null)[];
  prior: Moderated;
  significant: Uint8Array;
  nUp: number;
  nDown: number;
}

/** Per-protein group-means linear model (limma `~0 + condition` with NA handling). */
export function groupFits(m: Matrix, groupOf: number[], G: number) {
  const nP = m[0]?.length ?? 0;
  const means = Array.from({ length: G }, () => new Float64Array(nP).fill(NaN));
  const counts = Array.from({ length: G }, () => new Int32Array(nP));
  const s2 = new Float64Array(nP).fill(NaN);
  const df = new Float64Array(nP);
  for (let r = 0; r < nP; r++) {
    const sum = new Float64Array(G);
    for (let j = 0; j < m.length; j++) {
      const v = m[j][r];
      if (!Number.isFinite(v)) continue;
      sum[groupOf[j]] += v;
      counts[groupOf[j]][r]++;
    }
    let present = 0;
    let n = 0;
    for (let g = 0; g < G; g++) {
      if (counts[g][r] > 0) {
        means[g][r] = sum[g] / counts[g][r];
        present++;
        n += counts[g][r];
      }
    }
    let rss = 0;
    for (let j = 0; j < m.length; j++) {
      const v = m[j][r];
      if (Number.isFinite(v)) rss += (v - means[groupOf[j]][r]) ** 2;
    }
    df[r] = n - present;
    s2[r] = df[r] > 0 ? rss / df[r] : NaN;
  }
  return { means, counts, s2, df };
}

export function differential(proc: Processed, p: Params): ContrastResult[] {
  const G = proc.conditions.length;
  const fit = groupFits(proc.imputed, proc.groupOf, G);
  return p.contrasts
    .filter(([a, b]) => proc.conditions.includes(a) && proc.conditions.includes(b) && a !== b)
    .map(([a, b]) => {
      const ga = proc.conditions.indexOf(a);
      const gb = proc.conditions.indexOf(b);
      const fits: (ContrastFit | null)[] = proc.rows.map((_, r) => {
        const na = fit.counts[ga][r];
        const nb = fit.counts[gb][r];
        if (!na || !nb || !(fit.df[r] > 0)) return null;
        return {
          logFC: fit.means[ga][r] - fit.means[gb][r],
          stdUnscaled: Math.sqrt(1 / na + 1 / nb),
          s2: fit.s2[r],
          df: fit.df[r],
        };
      });
      const { rows, prior } = moderate(fits, { s2: fit.s2, df: fit.df }, { moderated: p.test === "limma" });
      const significant = new Uint8Array(rows.length);
      let nUp = 0;
      let nDown = 0;
      rows.forEach((x, i) => {
        if (!x) return;
        const pv = p.useAdjusted ? x.adjP : x.p;
        if (pv < p.alpha && Math.abs(x.logFC) >= p.lfc) {
          significant[i] = 1;
          if (x.logFC > 0) nUp++;
          else nDown++;
        }
      });
      return { name: `${a} vs ${b}`, a, b, rows, prior, significant, nUp, nDown };
    });
}

export function defaultContrasts(conditions: string[], mode: "control" | "pairwise", control?: string): [string, string][] {
  if (conditions.length < 2) return [];
  if (mode === "control") {
    const ctl = control && conditions.includes(control) ? control : conditions[0];
    return conditions.filter((c) => c !== ctl).map((c) => [c, ctl]);
  }
  const out: [string, string][] = [];
  for (let i = 0; i < conditions.length; i++)
    for (let j = i + 1; j < conditions.length; j++) out.push([conditions[j], conditions[i]]);
  return out;
}

// -------------------------------------------------------------------- PCA

/** Symmetric eigendecomposition via cyclic Jacobi (fine for n ≲ 200). */
export function jacobiEigen(A: number[][]) {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = a.map((_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

export interface PCAResult {
  scores: number[][]; // [component][sample]
  explained: number[]; // fraction per component
  nFeatures: number;
}

/** PCA of samples using complete proteins (optionally the top-N most variable). */
export function pca(m: Matrix, topN = 0): PCAResult {
  const nS = m.length;
  const nP = m[0]?.length ?? 0;
  const rows: number[] = [];
  for (let r = 0; r < nP; r++) {
    let ok = true;
    for (let j = 0; j < nS; j++) if (!Number.isFinite(m[j][r])) { ok = false; break; }
    if (ok) rows.push(r);
  }
  const centred = rows.map((r) => {
    let s = 0;
    for (let j = 0; j < nS; j++) s += m[j][r];
    const mu = s / nS;
    const x = new Float64Array(nS);
    let v = 0;
    for (let j = 0; j < nS; j++) { x[j] = m[j][r] - mu; v += x[j] ** 2; }
    return { x, v };
  });
  let feats = centred;
  if (topN > 0 && centred.length > topN) feats = [...centred].sort((a, b) => b.v - a.v).slice(0, topN);
  const gram = Array.from({ length: nS }, () => new Array(nS).fill(0));
  for (const { x } of feats)
    for (let i = 0; i < nS; i++) for (let j = i; j < nS; j++) gram[i][j] += x[i] * x[j];
  for (let i = 0; i < nS; i++) for (let j = 0; j < i; j++) gram[i][j] = gram[j][i];
  const { values, vectors } = jacobiEigen(gram);
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  const k = Math.max(0, Math.min(nS - 1, 10));
  return {
    scores: vectors.slice(0, k).map((vec, c) => vec.map((u) => u * Math.sqrt(Math.max(0, values[c])))),
    explained: values.slice(0, k).map((v) => Math.max(0, v) / total),
    nFeatures: feats.length,
  };
}

// ------------------------------------------------------------- clustering

export interface Tree {
  left?: Tree;
  right?: Tree;
  leaf?: number;
  height: number;
}

/** Average-linkage hierarchical clustering on a full distance matrix. */
export function hclust(dist: number[][]): { order: number[]; tree: Tree } {
  const n = dist.length;
  if (n === 0) return { order: [], tree: { height: 0 } };
  const d = dist.map((r) => Float64Array.from(r));
  const nodes: (Tree | null)[] = Array.from({ length: n }, (_, i) => ({ leaf: i, height: 0 }));
  const size = new Array(n).fill(1);
  const active = new Set(Array.from({ length: n }, (_, i) => i));
  while (active.size > 1) {
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    const act = [...active];
    for (let x = 0; x < act.length; x++)
      for (let y = x + 1; y < act.length; y++) {
        const v = d[act[x]][act[y]];
        if (v < best) { best = v; bi = act[x]; bj = act[y]; }
      }
    if (bi < 0) { bi = act[0]; bj = act[1]; best = 0; }
    for (const k of active) {
      if (k === bi || k === bj) continue;
      const v = (d[bi][k] * size[bi] + d[bj][k] * size[bj]) / (size[bi] + size[bj]);
      d[bi][k] = d[k][bi] = v;
    }
    nodes[bi] = { left: nodes[bi]!, right: nodes[bj]!, height: Number.isFinite(best) ? best : 0 };
    nodes[bj] = null;
    size[bi] += size[bj];
    active.delete(bj);
  }
  const tree = nodes[[...active][0]]!;
  const order: number[] = [];
  const walk = (t: Tree): void => {
    if (t.leaf !== undefined) order.push(t.leaf);
    else { walk(t.left!); walk(t.right!); }
  };
  walk(tree);
  return { order, tree };
}

export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { n++; sa += a[i]; sb += b[i]; }
  if (n < 3) return NaN;
  const ma = sa / n, mb = sb / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++)
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2;
    }
  return sab / Math.sqrt(saa * sbb);
}

export function euclidean(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { s += (a[i] - b[i]) ** 2; n++; }
  return n ? Math.sqrt((s * a.length) / n) : Infinity;
}

/** Coefficient of variation (%) on the linear scale, per condition. */
export function cvByCondition(proc: Processed): { condition: string; cvs: Float64Array }[] {
  return proc.conditions.map((cond, g) => {
    const cols = proc.normalized.filter((_, j) => proc.groupOf[j] === g);
    const out: number[] = [];
    if (cols.length >= 2) {
      for (let r = 0; r < proc.rows.length; r++) {
        const v: number[] = [];
        for (const c of cols) if (Number.isFinite(c[r])) v.push(2 ** c[r]);
        if (v.length < 2) continue;
        const mu = mean(v);
        const sdv = Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / (v.length - 1));
        out.push((100 * sdv) / mu);
      }
    }
    return { condition: cond, cvs: Float64Array.from(out) };
  });
}
