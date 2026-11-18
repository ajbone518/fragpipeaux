import { describe, expect, it } from "vitest";
import { applyAnnotationTable, buildDataset, inferAnnotation, parseTable } from "./parse";
import { defaultContrasts, defaultParams, differential, factorialContrasts, guessDesign, hclust, impute, jacobiEigen, normalize, pca, process, resolveDesign, rng, type FactorDesign, type Processed } from "./pipeline";
import { demoFiles } from "./demo";
import { finiteSorted, median } from "./stats";

describe("parsing", () => {
  it("parses quoted CSV", () => {
    const t = parseTable('id,"a, b",c\nx,"1",2\n"y ""q""",3,4\n');
    expect(t.headers).toEqual(["id", "a, b", "c"]);
    expect(t.rows[1][0]).toBe('y "q"');
  });

  it("detects FragPipe LFQ columns and keeps Intensity separate from MaxLFQ", () => {
    const { proteins } = demoFiles(200);
    const ds = buildDataset(parseTable(proteins), "demo");
    expect(ds.source).toBe("fragpipe-lfq");
    expect(ds.samples).toHaveLength(12);
    expect(ds.quantTypes.map((q) => q.key)).toEqual(["MaxLFQ Intensity", "Intensity", "Spectral Count"]);
    expect(ds.contaminant.filter(Boolean).length).toBe(12);
  });

  it("detects TMT-Integrator output as log2", () => {
    const txt = "Index\tNumberPSM\tProteinID\tMaxPepProb\tReferenceIntensity\tS1\tS2\nGENE1\t4\tP1\t1\t20\t0.5\t-0.3\nGENE2\t2\tP2\t1\t19\tNA\t0.1";
    const ds = buildDataset(parseTable(txt), "tmt");
    expect(ds.source).toBe("fragpipe-tmt");
    expect(ds.samples).toEqual(["S1", "S2"]);
    expect(ds.quantTypes[0].isLog2).toBe(true);
    expect(Number.isNaN(ds.quantTypes[0].values[0][1])).toBe(true);
  });

  it("detects DIA-NN matrices and strips file paths", () => {
    const txt = "Protein.Group\tProtein.Ids\tProtein.Names\tGenes\tFirst.Protein.Description\tC:\\runs\\A_1.raw\t/x/B_1.mzML\nP1\tP1\tN\tG1\tdesc\t1000\t2000";
    const ds = buildDataset(parseTable(txt), "dia");
    expect(ds.source).toBe("diann");
    expect(ds.samples).toEqual(["A_1", "B_1"]);
  });

  it("infers conditions from replicate suffixes", () => {
    const a = inferAnnotation(["WT_1", "WT_2", "KO-rep1", "KO-rep2"]);
    expect(a.map((x) => x.condition)).toEqual(["WT", "WT", "KO", "KO"]);
    expect(a.map((x) => x.replicate)).toEqual([1, 2, 1, 2]);
  });

  it("applies experiment_annotation.tsv", () => {
    const samples = ["s1", "s2"];
    const t = parseTable("file\tsample\tsample_name\tcondition\treplicate\n/a/s1.raw\ts1\tCtl_A\tCtl\t1\n/a/s2.raw\ts2\tTrt_A\tTrt\t1");
    const { annotation, matched } = applyAnnotationTable(samples, t, inferAnnotation(samples));
    expect(matched).toBe(2);
    expect(annotation.map((a) => a.condition)).toEqual(["Ctl", "Trt"]);
  });
});

describe("pipeline", () => {
  const { proteins, annotation } = demoFiles();
  const ds = buildDataset(parseTable(proteins), "demo");
  const anno = applyAnnotationTable(ds.samples, parseTable(annotation), inferAnnotation(ds.samples)).annotation;

  it("median normalisation equalises sample medians", () => {
    const m = [Float64Array.of(1, 2, 3, NaN), Float64Array.of(5, 6, 7, 8)];
    const n = normalize(m, "median");
    expect(median(finiteSorted(n[0]))).toBeCloseTo(median(finiteSorted(n[1])), 12);
  });

  it("quantile normalisation gives identical distributions for complete data", () => {
    const m = [Float64Array.of(1, 5, 3), Float64Array.of(10, 30, 20)];
    const n = normalize(m, "quantile");
    expect(Array.from(finiteSorted(n[0]))).toEqual(Array.from(finiteSorted(n[1])));
  });

  it("recovers the planted interferon signal", () => {
    const p = { ...defaultParams("MaxLFQ Intensity"), contrasts: defaultContrasts(["Control", "Treated", "Knockout"], "control") };
    const proc = process(ds, anno, p);
    expect(proc.conditions).toEqual(["Control", "Treated", "Knockout"]);
    expect(proc.rows.some((r) => ds.contaminant[r])).toBe(false);
    for (const col of proc.imputed) for (const v of col) expect(Number.isFinite(v)).toBe(true);

    const res = differential(proc, p);
    expect(res.map((r) => r.name)).toEqual(["Treated vs Control", "Knockout vs Control"]);
    const trt = res[0];
    const sigGenes = new Set(proc.rows.filter((_, i) => trt.significant[i]).map((r) => ds.genes[r]));
    for (const g of ["ISG15", "MX1", "STAT1"]) expect(sigGenes.has(g)).toBe(true);
    // most planted interferon genes are recovered (a few lose out to MAR
    // dropouts imputed as low values, which is expected for Perseus imputation)
    const ifn = ["ISG15", "IFIT1", "IFIT2", "IFIT3", "MX1", "MX2", "OAS1", "OAS2", "OAS3", "STAT1", "STAT2", "IRF7", "RSAD2", "IFI44", "BST2", "GBP1", "PSMB8", "TAP1"];
    const present = ifn.filter((g) => proc.rows.some((r) => ds.genes[r] === g));
    expect(present.filter((g) => sigGenes.has(g)).length / present.length).toBeGreaterThan(0.7);
    // and few unrelated housekeeping proteins are called
    expect(["ACTB", "GAPDH", "TUBB", "HSPA8", "ENO1"].filter((g) => sigGenes.has(g)).length).toBeLessThanOrEqual(1);
    expect(trt.nUp).toBeGreaterThan(trt.nDown);
    const ko = res[1];
    const isMKI67 = proc.rows.findIndex((r) => ds.genes[r] === "MKI67");
    if (isMKI67 >= 0) expect(ko.rows[isMKI67]!.logFC).toBeLessThan(-0.8);
    // moderation produced a finite positive prior
    expect(trt.prior.s20).toBeGreaterThan(0);
  });

  it("PCA separates conditions on PC1/PC2", () => {
    const p = defaultParams("MaxLFQ Intensity");
    const proc = process(ds, anno, p);
    const res = pca(proc.imputed, 500);
    expect(res.explained[0]).toBeGreaterThan(res.explained[1]);
    const sum = res.explained.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("kNN imputation restores values close to the truth for MAR dropouts", () => {
    const R = rng(5);
    const nP = 400, nS = 6;
    const truth = Array.from({ length: nS }, () => new Float64Array(nP));
    for (let r = 0; r < nP; r++) {
      const base = 20 + 6 * R.next();
      for (let j = 0; j < nS; j++) truth[j][r] = base + 0.1 * R.normal();
    }
    const m = truth.map((c) => Float64Array.from(c));
    const holes: [number, number][] = [];
    for (let r = 0; r < nP; r += 7) { m[r % nS][r] = NaN; holes.push([r % nS, r]); }
    const { imputed, mask } = impute(m, [0, 0, 0, 1, 1, 1], { imputation: "knn", shift: 1.8, width: 0.3, seed: 1 });
    for (const [j, r] of holes) {
      expect(mask[j][r]).toBe(1);
      expect(Math.abs(imputed[j][r] - truth[j][r])).toBeLessThan(0.6);
    }
  });

  it("Perseus imputation is reproducible for a fixed seed and lands below observed values", () => {
    const m = [Float64Array.of(20, 22, NaN, 25, 24, NaN), Float64Array.of(21, NaN, 23, 25, 24, 26)];
    const a = impute(m, [0, 1], { imputation: "perseus", shift: 1.8, width: 0.3, seed: 9 });
    const b = impute(m, [0, 1], { imputation: "perseus", shift: 1.8, width: 0.3, seed: 9 });
    expect(Array.from(a.imputed[0])).toEqual(Array.from(b.imputed[0]));
    expect(a.imputed[0][2]).toBeLessThan(22);
  });

  it("jacobiEigen diagonalises a symmetric matrix", () => {
    const { values } = jacobiEigen([[2, 1], [1, 2]]);
    expect(values[0]).toBeCloseTo(3, 10);
    expect(values[1]).toBeCloseTo(1, 10);
  });

  it("hclust groups close points", () => {
    const pts = [0, 0.1, 5, 5.2, 0.05];
    const d = pts.map((a) => pts.map((b) => Math.abs(a - b)));
    const { order } = hclust(d);
    const pos = (i: number) => order.indexOf(i);
    expect(Math.abs(pos(2) - pos(3))).toBe(1);
  });
});

describe("2x2 factorial contrasts", () => {
  // Four conditions x 3 replicates. Protein 0 has a pure interaction: the
  // "+aTC" effect is +1 in B and 0 in A. Protein 1 has a main effect of factor
  // 1 only. Protein 2 is flat.
  const conditions = ["A", "A_aTC", "B", "B_aTC"];
  const cellMeans = [
    [10, 10, 12, 13], // interaction = (13-12) - (10-10) = +1
    [10, 10, 12, 12], // factor-1 main effect = +2, interaction = 0
    [10, 10, 10, 10],
  ];
  // deterministic jitter so the residual variance is non-zero but tiny
  const jitter = [0.02, -0.02, 0.0];
  const groupOf = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3];
  const imputed = groupOf.map((g, j) =>
    Float64Array.from(cellMeans.map((m) => m[g] + jitter[j % 3])),
  );
  const proc = {
    samples: [], conditions, groupOf, rows: [0, 1, 2],
    log2Raw: imputed, normalized: imputed, imputed,
    imputedMask: [], steps: [],
  } as unknown as Processed;

  const design = (include: Partial<FactorDesign["include"]> = {}): FactorDesign => ({
    names: ["strain", "aTC"],
    assign: { A: ["A", "no"], A_aTC: ["A", "yes"], B: ["B", "no"], B_aTC: ["B", "yes"] },
    ref: ["A", "no"],
    include: { interaction: true, main1: false, main2: false, ...include },
  });

  it("estimates the interaction as (B:+aTC − B:−aTC) − (A:+aTC − A:−aTC)", () => {
    const p = { ...defaultParams("x"), contrasts: [], design: design(), test: "ttest" as const };
    const res = differential(proc, p);
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("interaction");
    expect(res[0].rows[0]!.logFC).toBeCloseTo(1, 12);
    expect(res[0].rows[1]!.logFC).toBeCloseTo(0, 12);
    expect(res[0].rows[2]!.logFC).toBeCloseTo(0, 12);
    // all four groups feed the contrast
    expect(res[0].groups.slice().sort()).toEqual([0, 1, 2, 3]);
  });

  it("uses the four-group standard error, not a two-group one", () => {
    const p = { ...defaultParams("x"), contrasts: [["B", "A"]] as [string, string][], design: design(), test: "ttest" as const };
    const [pair, inter] = differential(proc, p);
    // stdUnscaled is sqrt(1/3+1/3) pairwise vs sqrt(4/3) for the interaction,
    // so the interaction SE is exactly sqrt(2)x the pairwise SE at equal n.
    expect(inter.rows[0]!.se / pair.rows[0]!.se).toBeCloseTo(Math.SQRT2, 10);
  });

  it("main effects average over the other factor", () => {
    const p = { ...defaultParams("x"), contrasts: [], design: design({ main1: true, main2: true }), test: "ttest" as const };
    const res = differential(proc, p);
    const m1 = res.find((r) => r.kind === "main" && r.name.startsWith("strain"))!;
    const m2 = res.find((r) => r.kind === "main" && r.name.startsWith("aTC"))!;
    // protein 0: strain effect = mean(12,13) - mean(10,10) = 2.5
    expect(m1.rows[0]!.logFC).toBeCloseTo(2.5, 12);
    // protein 0: aTC effect = mean(10,13) - mean(10,12) = 0.5
    expect(m2.rows[0]!.logFC).toBeCloseTo(0.5, 12);
    // protein 1: pure factor-1 effect of 2, no aTC effect
    expect(m1.rows[1]!.logFC).toBeCloseTo(2, 12);
    expect(m2.rows[1]!.logFC).toBeCloseTo(0, 12);
  });

  it("swapping the baseline flips the sign", () => {
    const d = design();
    const flipped = { ...d, ref: ["B", "no"] as [string, string] };
    const p = { ...defaultParams("x"), contrasts: [], test: "ttest" as const };
    expect(differential(proc, { ...p, design: d })[0].rows[0]!.logFC).toBeCloseTo(1, 12);
    expect(differential(proc, { ...p, design: flipped })[0].rows[0]!.logFC).toBeCloseTo(-1, 12);
  });

  it("rejects designs that are not a complete 2x2", () => {
    const bad = (patch: Partial<FactorDesign>) => resolveDesign(conditions, { ...design(), ...patch });
    expect(resolveDesign(conditions, design()).ok).toBe(true);
    // a condition left unassigned
    expect(bad({ assign: { A: ["A", "no"], A_aTC: ["A", "yes"], B: ["B", "no"], B_aTC: ["", ""] } }).ok).toBe(false);
    // three levels on a factor
    expect(bad({ assign: { A: ["A", "no"], A_aTC: ["A", "yes"], B: ["B", "no"], B_aTC: ["C", "yes"] } }).ok).toBe(false);
    // two conditions in the same cell
    expect(bad({ assign: { A: ["A", "no"], A_aTC: ["A", "no"], B: ["B", "no"], B_aTC: ["B", "yes"] } }).ok).toBe(false);
    expect(factorialContrasts(conditions, { ...design(), ref: ["A", "no"], assign: {} })).toEqual([]);
  });

  it("guesses a design from a shared suffix", () => {
    const g = guessDesign(["Nt", "Nt_aTC", "TopAkd", "TopAkd_aTC"]);
    expect(g).not.toBeNull();
    expect(g!.names[1]).toBe("aTC");
    expect(g!.assign["TopAkd_aTC"]).toEqual(["TopAkd", "aTC"]);
    expect(g!.assign["Nt"]).toEqual(["Nt", "no aTC"]);
    expect(resolveDesign(["Nt", "Nt_aTC", "TopAkd", "TopAkd_aTC"], g).ok).toBe(true);
    // nothing to find
    expect(guessDesign(["A", "B", "C", "D"])).toBeNull();
    expect(guessDesign(["A", "B", "C"])).toBeNull();
  });
});
