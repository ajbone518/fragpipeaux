import { rng } from "./pipeline";

/**
 * Synthetic FragPipe LFQ `combined_protein.tsv` + `experiment_annotation.tsv`.
 * Three conditions × 4 replicates; Treated shows an interferon response,
 * Knockout loses cell-cycle proteins. Intensity-dependent (MNAR) missingness.
 */
const IFN = "ISG15 IFIT1 IFIT2 IFIT3 IFIT5 MX1 MX2 OAS1 OAS2 OAS3 OASL STAT1 STAT2 IRF7 IRF9 RSAD2 IFI44 IFI44L IFI6 IFI35 IFITM1 IFITM3 BST2 RIGI IFIH1 HERC5 HERC6 USP18 PARP9 PARP14 DTX3L SAMD9 SAMD9L XAF1 EPSTI1 TRIM21 TRIM22 TRIM25 PLSCR1 GBP1 GBP2 GBP4 B2M TAP1 TAP2 PSMB8 PSMB9 PSME1 PSME2 SP100 SP110 DDX60 CMPK2 LGALS3BP ZBP1 EIF2AK2 ADAR UBE2L6 NMI LAP3".split(" ");
const CELL_CYCLE = "MKI67 TOP2A PCNA MCM2 MCM3 MCM4 MCM5 MCM6 MCM7 CDK1 CCNB1 CCNA2 AURKA AURKB PLK1 BUB1 BUB1B KIF11 KIF2C CENPF TPX2 NUSAP1 RRM2 TYMS FEN1 RFC4 SMC4 NCAPG ESPL1 CDC20".split(" ");
const HOUSE = "ACTB GAPDH TUBB TUBA1B HSP90AA1 HSPA8 EEF1A1 PKM ENO1 ALDOA LDHA PGK1 TPI1 VIM RPLP0 RPS3 RPL7 HNRNPA1 PPIA YWHAZ CFL1 PFN1 ANXA2 MYH9 FLNA TLN1 VCL ACTN4 CALR HSPA5 P4HB PDIA3 CANX SOD1 PRDX1 PRDX2 TXN GSTP1 NME1 ATP5F1A ATP5F1B VDAC1 SLC25A5 HADHA ACLY FASN".split(" ");

export function demoFiles(nProteins = 2600, seed = 7) {
  const R = rng(seed);
  const conds = ["Control", "Treated", "Knockout"];
  const reps = 4;
  const samples = conds.flatMap((c) => Array.from({ length: reps }, (_, i) => `${c}_${i + 1}`));
  const genes: string[] = [...IFN, ...CELL_CYCLE, ...HOUSE];
  while (genes.length < nProteins) genes.push(`DEMO${String(genes.length + 1).padStart(4, "0")}`);
  const nCont = 12;

  const sampleOffset = samples.map(() => R.normal() * 0.35); // loading differences
  const header = [
    "Protein", "Protein ID", "Entry Name", "Gene", "Protein Length", "Organism", "Description",
    "Protein Probability", "Combined Total Peptides",
    ...samples.map((s) => `${s} Spectral Count`),
    ...samples.map((s) => `${s} Intensity`),
    ...samples.map((s) => `${s} MaxLFQ Intensity`),
  ];
  const lines = [header.join("\t")];
  const all = [...genes.map((g, i) => ({ g, i, cont: false })), ...Array.from({ length: nCont }, (_, k) => ({ g: `KRT${k + 1}`, i: genes.length + k, cont: true }))];
  for (const { g, i, cont } of all) {
    const acc = cont ? `contam_P${String(10000 + i)}` : `Q${String(100000 + i * 7).slice(0, 5)}${String.fromCharCode(65 + (i % 26))}`;
    const base = 26 + 2.4 * R.normal();
    const eff = conds.map(() => 0);
    if (IFN.includes(g)) eff[1] = 1.6 + 1.4 * R.next();
    if (CELL_CYCLE.includes(g)) eff[2] = -(1.2 + 1.2 * R.next());
    if (!IFN.includes(g) && !CELL_CYCLE.includes(g) && !HOUSE.includes(g) && R.next() < 0.03)
      eff[1 + (R.next() < 0.5 ? 1 : 0)] = (R.next() < 0.5 ? -1 : 1) * (1 + R.next() * 1.5);
    const vals = samples.map((_, j) => {
      const c = Math.floor(j / reps);
      const v = base + eff[c] + sampleOffset[j] + 0.25 * R.normal();
      // MNAR: low abundance more likely missing
      const pMiss = 1 / (1 + Math.exp((v - 22.5) * 1.6)) + 0.01;
      return R.next() < pMiss ? 0 : 2 ** v;
    });
    const peps = Math.max(1, Math.round(2 ** (base - 22) + R.next() * 3));
    const sc = vals.map((v) => (v > 0 ? Math.max(1, Math.round(v / 2 ** 22)) : 0));
    lines.push([
      cont ? `contam_sp|${acc}|${g}_HUMAN` : `sp|${acc}|${g}_HUMAN`,
      acc, `${g}_HUMAN`, g, String(200 + Math.floor(R.next() * 1500)), "Homo sapiens",
      cont ? "Keratin (contaminant)" : `${g} protein`,
      "1.000", String(peps),
      ...sc.map(String),
      ...vals.map((v) => (v > 0 ? (v * (1 + 0.05 * R.normal())).toFixed(1) : "0")),
      ...vals.map((v) => (v > 0 ? v.toFixed(1) : "0")),
    ].join("\t"));
  }
  const anno = [
    "file\tsample\tsample_name\tcondition\treplicate",
    ...samples.map((s, j) => `/data/raw/${s}.raw\t${s}\t${s}\t${conds[Math.floor(j / reps)]}\t${(j % reps) + 1}`),
  ].join("\n");
  return { proteins: lines.join("\n"), annotation: anno };
}
