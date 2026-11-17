/**
 * Statistics primitives: special functions, t distribution, limma-style
 * empirical-Bayes moderation and multiple-testing correction.
 * Dependency-free and validated against scipy in stats.test.ts.
 */

export const mean = (a: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
};

export const variance = (a: ArrayLike<number>): number => {
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return s / (a.length - 1);
};

export const sd = (a: ArrayLike<number>) => Math.sqrt(variance(a));

export function quantile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function median(a: ArrayLike<number>): number {
  const s = Float64Array.from(a as ArrayLike<number>).sort();
  return quantile(s, 0.5);
}

/** Drop NaNs and return a sorted copy. */
export function finiteSorted(a: ArrayLike<number>): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) out.push(a[i]);
  return Float64Array.from(out).sort();
}

// ---------------------------------------------------------------- gamma family

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function digamma(x: number): number {
  let r = 0;
  while (x < 6) {
    r -= 1 / x;
    x += 1;
  }
  const f = 1 / (x * x);
  return (
    r + Math.log(x) - 0.5 / x -
    f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f * (1 / 132)))))
  );
}

export function trigamma(x: number): number {
  let r = 0;
  while (x < 6) {
    r += 1 / (x * x);
    x += 1;
  }
  const f = 1 / (x * x);
  return (
    r + 1 / x + f / 2 +
    (f / x) * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f * (1 / 30 - f * (5 / 66)))))
  );
}

/** Solve trigamma(y) = x for y (Newton on 1/trigamma, as in limma). */
export function trigammaInverse(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (x > 1e7) return 1 / Math.sqrt(x);
  if (x < 1e-6) return 1 / x;
  let y = 0.5 + 1 / x;
  for (let i = 0; i < 50; i++) {
    const tri = trigamma(y);
    const dif = (tri * (1 - tri / x)) / (trigammaPrime(y));
    y += dif;
    if (-dif / y < 1e-8) break;
  }
  return y;
}

/** Derivative of trigamma (tetragamma). */
function trigammaPrime(x: number): number {
  let r = 0;
  while (x < 6) {
    r -= 2 / (x * x * x);
    x += 1;
  }
  // psi''(x) ~ -1/x^2 - 1/x^3 - 1/(2x^4) + 1/(6x^6) - 1/(6x^8) + 3/(10x^10) - 5/(6x^12)
  const f = 1 / (x * x);
  return (
    r - f - f / x -
    f * f * (1 / 2 - f * (1 / 6 - f * (1 / 6 - f * (3 / 10 - f * (5 / 6)))))
  );
}

// --------------------------------------------------------- incomplete beta / t

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  const bt = Math.exp(lbt);
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a t statistic. Infinite df gives the normal. */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return Number.isNaN(t) ? NaN : 0;
  const at = Math.abs(t);
  // Beyond ~1e7 df the lgamma differences inside ibeta cancel badly; the
  // normal limit is accurate to <1e-7 relative there.
  if (!Number.isFinite(df) || df > 1e7) return erfc(at / Math.SQRT2);
  const x = df / (df + at * at);
  return Math.min(1, ibeta(x, df / 2, 0.5));
}

export function erfc(x: number): number {
  // Complementary error function (W. J. Cody-style rational approx via
  // continued fraction / series; accurate to ~1e-15 for our purposes).
  const z = Math.abs(x);
  let r: number;
  if (z < 2.5) {
    // series for erf
    let sum = z;
    let term = z;
    for (let n = 1; n < 100; n++) {
      term *= (-z * z) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    r = 1 - (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    // continued fraction for erfc
    let f = 0;
    for (let k = 60; k >= 1; k--) f = k / 2 / (z + f);
    r = Math.exp(-z * z) / Math.sqrt(Math.PI) / (z + f);
  }
  return x >= 0 ? r : 2 - r;
}

// ----------------------------------------------------------- limma-style eBayes

export interface Moderated {
  df2: number; // prior degrees of freedom
  s20: number; // prior variance
}

/**
 * Estimate the scaled-F prior of the residual variances (limma::fitFDist,
 * non-robust method of moments) allowing per-protein degrees of freedom.
 */
export function fitFDist(s2: ArrayLike<number>, df: ArrayLike<number>): Moderated {
  // Clamp zero variances relative to the median like limma does.
  const positive: number[] = [];
  for (let i = 0; i < s2.length; i++) if (df[i] > 0 && s2[i] > 0 && Number.isFinite(s2[i])) positive.push(s2[i]);
  const med = positive.length ? median(positive) : 1;
  const z: number[] = [];
  const h: number[] = [];
  for (let i = 0; i < s2.length; i++) {
    if (!(df[i] > 0) || !Number.isFinite(s2[i])) continue;
    const x = Math.max(s2[i], 1e-5 * med);
    h.push(df[i] / 2);
    z.push(Math.log(x) - digamma(df[i] / 2) + Math.log(df[i] / 2));
  }
  const n = z.length;
  if (n < 2) return { df2: 0, s20: med };
  const emean = mean(z);
  let evar = variance(z);
  let tri = 0;
  for (const v of h) tri += trigamma(v);
  evar -= tri / n;
  if (evar > 0) {
    const df2 = 2 * trigammaInverse(evar);
    // limma: s20 = exp(emean + digamma(df2/2) - log(df2/2))
    const s20 = Math.exp(emean + digamma(df2 / 2) - Math.log(df2 / 2));
    return { df2, s20 };
  }
  return { df2: Infinity, s20: Math.exp(emean) };
}

export interface ContrastFit {
  logFC: number;
  /** sqrt of the unscaled variance factor of the contrast */
  stdUnscaled: number;
  /** residual variance (ordinary) */
  s2: number;
  df: number;
}

export interface TestRow {
  logFC: number;
  t: number;
  p: number;
  /** ordinary (unmoderated) p-value */
  pOrd: number;
  df: number;
  se: number;
  adjP: number;
}

/** Benjamini–Hochberg adjusted p-values (NaN passes through). */
export function bh(p: ArrayLike<number>): Float64Array {
  const idx: number[] = [];
  for (let i = 0; i < p.length; i++) if (Number.isFinite(p[i])) idx.push(i);
  idx.sort((a, b) => p[a] - p[b]);
  const m = idx.length;
  const out = new Float64Array(p.length).fill(NaN);
  let prev = 1;
  for (let r = m - 1; r >= 0; r--) {
    const i = idx[r];
    prev = Math.min(prev, (p[i] * m) / (r + 1));
    out[i] = Math.min(1, prev);
  }
  return out;
}

/**
 * Apply empirical-Bayes moderation to a set of per-protein contrast fits.
 * `fits[i]` may be null where a contrast is not estimable.
 */
export function moderate(
  fits: (ContrastFit | null)[],
  allVar?: { s2: ArrayLike<number>; df: ArrayLike<number> },
  options: { moderated: boolean } = { moderated: true },
): { rows: (TestRow | null)[]; prior: Moderated } {
  // The prior is estimated from every protein's residual variance, not just
  // those where this particular contrast is estimable.
  const s2 = allVar?.s2 ?? fits.map((f) => (f ? f.s2 : NaN));
  const dfv = allVar?.df ?? fits.map((f) => (f ? f.df : 0));
  const prior = options.moderated ? fitFDist(s2, dfv) : { df2: 0, s20: 1 };

  const raw: (Omit<TestRow, "adjP"> | null)[] = fits.map((f) => {
    if (!f || !(f.df > 0)) return null;
    const sPost =
      !options.moderated || prior.df2 === 0
        ? f.s2
        : Number.isFinite(prior.df2)
          ? (prior.df2 * prior.s20 + f.df * f.s2) / (prior.df2 + f.df)
          : prior.s20;
    const dfTot = options.moderated ? f.df + prior.df2 : f.df;
    const se = Math.sqrt(sPost) * f.stdUnscaled;
    const t = f.logFC / se;
    const seOrd = Math.sqrt(f.s2) * f.stdUnscaled;
    return {
      logFC: f.logFC,
      t,
      se,
      df: dfTot,
      p: tTwoSidedP(t, dfTot),
      pOrd: tTwoSidedP(f.logFC / seOrd, f.df),
    };
  });
  const adj = bh(raw.map((r) => (r ? r.p : NaN)));
  const rows = raw.map((r, i) => (r ? { ...r, adjP: adj[i] } : null));
  return { rows, prior };
}
