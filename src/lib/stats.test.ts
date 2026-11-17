import { describe, expect, it } from "vitest";
import { bh, digamma, erfc, fitFDist, lgamma, moderate, tTwoSidedP, trigamma, trigammaInverse } from "./stats";
import { groupFits, rng } from "./pipeline";

// Reference values computed with scipy 1.x (scipy.special / scipy.stats).
const X = [0.3, 1, 2.5, 7, 40];
const DIGAMMA = [-3.502524222200133, -0.5772156649015329, 0.7031566406452432, 1.872784335098467, 3.6763273740348428];
const TRIGAMMA = [12.245364546107734, 1.6449340668482266, 0.4903577561002349, 0.15354517795933756, 0.025315103841291032];
const LGAMMA = [1.0957979948180756, 0.0, 0.2846828704729192, 6.579251212010101, 106.63176026064345];
const T: [number, number, number][] = [
  [0.5, 3, 0.651447964848151], [2.1, 4, 0.10365328631760218], [-3.3, 10, 0.008013498113698335],
  [5, 2.5, 0.02345118997086185], [8, 30, 6.265822475700759e-9], [1.2, 1e9, 0.23013934072770495],
  [12, 6, 2.0307406195373192e-5],
];

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

describe("special functions", () => {
  it("match scipy", () => {
    X.forEach((x, i) => {
      expect(rel(digamma(x), DIGAMMA[i]) < 1e-10 || Math.abs(digamma(x) - DIGAMMA[i]) < 1e-12).toBe(true);
      expect(rel(trigamma(x), TRIGAMMA[i])).toBeLessThan(1e-10);
      expect(Math.abs(lgamma(x) - LGAMMA[i])).toBeLessThan(1e-10);
    });
  });
  it("trigammaInverse round-trips", () => {
    for (const y of [0.05, 0.4, 1, 3, 25, 400]) expect(rel(trigammaInverse(trigamma(y)), y)).toBeLessThan(1e-6);
  });
  it("erfc matches scipy", () => {
    const ref: [number, number][] = [[-1, 1.8427007929497148], [0.2, 0.7772974107895215], [1.7, 0.01620954140922544], [3, 2.2090496998585445e-5], [6, 2.1519736712498913e-17]];
    for (const [x, v] of ref) expect(rel(erfc(x), v)).toBeLessThan(1e-9);
  });
});

describe("t distribution", () => {
  it("two-sided p matches scipy", () => {
    for (const [t, df, p] of T) expect(rel(tTwoSidedP(t, df), p)).toBeLessThan(1e-7);
  });
});

describe("Benjamini–Hochberg", () => {
  it("matches reference", () => {
    const got = Array.from(bh([0.01, 0.04, 0.03, 0.5, 0.001, 0.2]));
    const ref = [0.03, 0.06, 0.06, 0.5, 0.006, 0.24];
    got.forEach((g, i) => expect(g).toBeCloseTo(ref[i], 12));
  });
  it("passes NaN through", () => {
    const got = bh([0.01, NaN, 0.02]);
    expect(Number.isNaN(got[1])).toBe(true);
    expect(got[0]).toBeCloseTo(0.02, 12);
  });
});

describe("group-means model", () => {
  it("unmoderated contrast equals the pooled two-sample t-test (scipy)", () => {
    const A = [20.1, 20.5, 19.8, 20.9];
    const B = [21.3, 21.9, 22.0];
    const m = [...A, ...B].map((v) => Float64Array.of(v));
    const groupOf = [0, 0, 0, 0, 1, 1, 1];
    const f = groupFits(m, groupOf, 2);
    const fit = { logFC: f.means[0][0] - f.means[1][0], stdUnscaled: Math.sqrt(1 / 4 + 1 / 3), s2: f.s2[0], df: f.df[0] };
    const { rows } = moderate([fit], undefined, { moderated: false });
    expect(rows[0]!.t).toBeCloseTo(-4.1774901176718275, 10);
    expect(rel(rows[0]!.p, 0.00867597158149406)).toBeLessThan(1e-7);
  });

  it("handles missing values by dropping them per protein", () => {
    const m = [[1, NaN], [2, 5], [4, 6], [5, 7]].map((r) => Float64Array.from(r));
    const f = groupFits(m, [0, 0, 1, 1], 2);
    expect(f.df[0]).toBe(2);
    expect(f.df[1]).toBe(1); // one group has a single observation
    expect(f.means[0][1]).toBe(5);
  });
});

describe("fitFDist", () => {
  it("recovers the prior of simulated scaled chi-square variances", () => {
    const R = rng(11);
    const d0 = 6, s0 = 0.08, d = 4;
    const s2: number[] = [];
    for (let i = 0; i < 20000; i++) {
      // sigma^2 ~ s0 * d0 / chi2(d0); s2 ~ sigma^2 * chi2(d) / d
      let c0 = 0; for (let k = 0; k < d0; k++) c0 += R.normal() ** 2;
      let c = 0; for (let k = 0; k < d; k++) c += R.normal() ** 2;
      s2.push(((s0 * d0) / c0) * (c / d));
    }
    const prior = fitFDist(s2, s2.map(() => d));
    expect(prior.df2).toBeGreaterThan(4.5);
    expect(prior.df2).toBeLessThan(8);
    expect(rel(prior.s20, s0)).toBeLessThan(0.08);
  });

  it("gives infinite prior df when variances are homogeneous", () => {
    const R = rng(3);
    const s2: number[] = [];
    for (let i = 0; i < 5000; i++) {
      let c = 0; for (let k = 0; k < 5; k++) c += R.normal() ** 2;
      s2.push((0.1 * c) / 5);
    }
    const prior = fitFDist(s2, s2.map(() => 5));
    expect(prior.df2 > 200).toBe(true);
    expect(rel(prior.s20, 0.1)).toBeLessThan(0.05);
  });
});
