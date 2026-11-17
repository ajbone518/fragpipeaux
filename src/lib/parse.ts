/**
 * Parsing and format detection for FragPipe output tables.
 *
 * Supported inputs
 *  - FragPipe LFQ / IonQuant `combined_protein.tsv`
 *    (`<sample> MaxLFQ Intensity`, `<sample> Intensity`, `<sample> Spectral Count`)
 *  - FragPipe TMT-Integrator `abundance_protein_*.tsv` / `ratio_protein_*.tsv`
 *    (already log2-scaled)
 *  - DIA-NN `report.pg_matrix.tsv` (FragPipe DIA workflow)
 *  - Any generic protein × sample matrix (first text columns = annotation)
 */

export type SourceKind = "fragpipe-lfq" | "fragpipe-tmt" | "diann" | "generic";

export interface QuantType {
  key: string;
  label: string;
  /** values[sample][protein]; NaN = missing */
  values: Float64Array[];
  isLog2: boolean;
}

export interface Dataset {
  name: string;
  source: SourceKind;
  ids: string[];
  genes: string[];
  descriptions: string[];
  samples: string[];
  quantTypes: QuantType[];
  contaminant: boolean[];
  /** e.g. Combined Total/Unique Peptides when available */
  peptides?: number[];
}

export interface Table {
  headers: string[];
  rows: string[][];
}

export const SOURCE_LABEL: Record<SourceKind, string> = {
  "fragpipe-lfq": "FragPipe LFQ (combined_protein.tsv)",
  "fragpipe-tmt": "FragPipe TMT-Integrator",
  diann: "DIA-NN protein-group matrix",
  generic: "Generic intensity matrix",
};

/** Parse TSV/CSV text; handles quoted fields for CSV. */
export function parseTable(text: string): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.slice(0, text.indexOf("\n") >>> 0 || text.length);
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delim = tabs >= commas ? "\t" : ",";
  const rows: string[][] = [];

  if (delim === "\t" && !text.includes('"')) {
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      rows.push(line.split("\t"));
    }
  } else {
    let field = "";
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === delim) {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
  }
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

const num = (s: string | undefined): number => {
  if (s === undefined) return NaN;
  const t = s.trim();
  if (t === "" || /^(na|nan|null|n\/a|inf|-inf)$/i.test(t)) return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
};

const findCol = (headers: string[], ...names: string[]) => {
  const lower = headers.map((h) => h.toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
};

const isContaminant = (id: string) => /(^|\|)(contam_|CON__|cont_)/i.test(id) || /^contam/i.test(id);

function columnValues(rows: string[][], col: number, zeroIsMissing: boolean): Float64Array {
  const out = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const v = num(rows[i][col]);
    out[i] = zeroIsMissing && v === 0 ? NaN : v;
  }
  return out;
}

const basename = (p: string) =>
  p.split(/[\\/]/).pop()!.replace(/\.(raw|mzml|d|dia|wiff|mzxml)$/i, "");

export function detectSource(headers: string[]): SourceKind {
  if (headers.some((h) => / MaxLFQ Intensity$| Intensity$| Spectral Count$/.test(h)) && findCol(headers, "Protein ID", "Protein") >= 0)
    return "fragpipe-lfq";
  if (findCol(headers, "ReferenceIntensity") >= 0 || (findCol(headers, "Index") >= 0 && findCol(headers, "NumberPSM") >= 0))
    return "fragpipe-tmt";
  if (findCol(headers, "Protein.Group") >= 0 && findCol(headers, "Genes") >= 0) return "diann";
  return "generic";
}

export function buildDataset(table: Table, name: string): Dataset {
  const { headers, rows } = table;
  const source = detectSource(headers);
  const col = (...n: string[]) => findCol(headers, ...n);
  const get = (c: number) => rows.map((r) => (c >= 0 ? (r[c] ?? "").trim() : ""));

  if (source === "fragpipe-lfq") {
    const ids = get(col("Protein ID", "Protein"));
    const proteinFull = get(col("Protein"));
    const genes = get(col("Gene", "Gene Names"));
    const desc = get(col("Description", "Protein Description"));
    const pepCol = col("Combined Total Peptides", "Combined Unique Peptides", "Unique Peptides");
    const suffixes: [string, string, boolean][] = [
      [" MaxLFQ Intensity", "MaxLFQ intensity", true],
      [" Intensity", "Intensity", true],
      [" Unique Intensity", "Unique intensity", true],
      [" Spectral Count", "Spectral count", true],
    ];
    const quantTypes: QuantType[] = [];
    let samples: string[] = [];
    for (const [suffix, label] of suffixes) {
      const cols = headers
        .map((h, i) => [h, i] as const)
        .filter(([h]) => h.endsWith(suffix) && !h.startsWith("Combined") &&
          // " Intensity" must not swallow MaxLFQ/Unique columns
          !(suffix === " Intensity" && / (MaxLFQ|Unique) Intensity$/.test(h)) &&
          !(suffix === " Spectral Count" && / (Unique|Total) Spectral Count$/.test(h)));
      if (!cols.length) continue;
      const names = cols.map(([h]) => h.slice(0, -suffix.length));
      if (!samples.length) samples = names;
      if (names.join("\u0000") !== samples.join("\u0000")) continue;
      quantTypes.push({
        key: suffix.trim(),
        label,
        values: cols.map(([, i]) => columnValues(rows, i, true)),
        isLog2: false,
      });
    }
    return {
      name,
      source,
      ids,
      genes: genes.map((g, i) => g || ids[i]),
      descriptions: desc,
      samples,
      quantTypes,
      contaminant: ids.map((id, i) => isContaminant(id) || isContaminant(proteinFull[i])),
      peptides: pepCol >= 0 ? rows.map((r) => num(r[pepCol])) : undefined,
    };
  }

  if (source === "fragpipe-tmt") {
    const idCol = col("Index", "ProteinID");
    const ids = get(idCol);
    const genes = get(col("Gene", "Index"));
    const known = new Set(["index", "numberpsm", "proteinid", "maxpepprob", "referenceintensity", "gene", "peptide", "protein", "entry", "description", "protein description", "organism"].map((s) => s));
    const sampleCols = headers
      .map((h, i) => [h, i] as const)
      .filter(([h]) => !known.has(h.toLowerCase()));
    return {
      name,
      source,
      ids,
      genes: genes.map((g, i) => g || ids[i]),
      descriptions: get(col("Description", "Protein Description")),
      samples: sampleCols.map(([h]) => h),
      quantTypes: [{
        key: "abundance",
        label: "TMT abundance (log2)",
        values: sampleCols.map(([, i]) => columnValues(rows, i, false)),
        isLog2: true,
      }],
      contaminant: ids.map(isContaminant),
      peptides: col("NumberPSM") >= 0 ? rows.map((r) => num(r[col("NumberPSM")])) : undefined,
    };
  }

  if (source === "diann") {
    const annot = new Set(["protein.group", "protein.ids", "protein.names", "genes", "first.protein.description", "n.sequences", "n.proteotypic.sequences"]);
    const sampleCols = headers.map((h, i) => [h, i] as const).filter(([h]) => !annot.has(h.toLowerCase()));
    const ids = get(col("Protein.Group"));
    return {
      name,
      source,
      ids,
      genes: get(col("Genes")).map((g, i) => g || ids[i]),
      descriptions: get(col("First.Protein.Description")),
      samples: sampleCols.map(([h]) => basename(h)),
      quantTypes: [{
        key: "pg",
        label: "Protein-group quantity",
        values: sampleCols.map(([, i]) => columnValues(rows, i, true)),
        isLog2: false,
      }],
      contaminant: ids.map(isContaminant),
    };
  }

  // Generic: numeric columns are samples, everything left of/among text cols is annotation.
  const numericCols: number[] = [];
  const textCols: number[] = [];
  const probe = rows.slice(0, 200);
  headers.forEach((_, c) => {
    let n = 0;
    let total = 0;
    for (const r of probe) {
      const s = (r[c] ?? "").trim();
      if (s === "" || /^(na|nan)$/i.test(s)) continue;
      total++;
      if (Number.isFinite(Number(s))) n++;
    }
    (total > 0 && n / total > 0.95 ? numericCols : textCols).push(c);
  });
  const idCol = textCols[0] ?? -1;
  const geneCol = textCols.find((c) => /gene/i.test(headers[c])) ?? idCol;
  const ids = idCol >= 0 ? get(idCol) : rows.map((_, i) => `row${i + 1}`);
  const values = numericCols.map((c) => columnValues(rows, c, true));
  // If everything is within a log-ish range assume already log2.
  let max = -Infinity;
  for (const v of values) for (const x of v) if (x > max) max = x;
  return {
    name,
    source,
    ids,
    genes: get(geneCol).map((g, i) => g || ids[i]),
    descriptions: get(textCols.find((c) => /desc/i.test(headers[c])) ?? -1),
    samples: numericCols.map((c) => headers[c]),
    quantTypes: [{ key: "value", label: "Intensity", values, isLog2: max < 50 }],
    contaminant: ids.map(isContaminant),
  };
}

// ------------------------------------------------------------- annotation

export interface SampleAnno {
  sample: string;
  label: string;
  condition: string;
  replicate: number;
  include: boolean;
}

/** Guess conditions from sample names: "WT_1", "WT-rep2", "KO 3" → WT / KO. */
export function inferAnnotation(samples: string[]): SampleAnno[] {
  const strip = (s: string) =>
    s.replace(/[_\-. ]*(rep|r|replicate|bio)?[_\-. ]*\d+$/i, "").trim() || s;
  const conds = samples.map(strip);
  const distinct = new Set(conds);
  const usable = distinct.size > 1 && distinct.size < samples.length;
  const counter = new Map<string, number>();
  return samples.map((s, i) => {
    const condition = usable ? conds[i] : "Group";
    const r = (counter.get(condition) ?? 0) + 1;
    counter.set(condition, r);
    return { sample: s, label: s, condition, replicate: r, include: true };
  });
}

const norm = (s: string) => s.toLowerCase().replace(/\.(raw|mzml|d)$/i, "").replace(/[^a-z0-9]/g, "");

/**
 * Apply a FragPipe `experiment_annotation.tsv` (file, sample, sample_name,
 * condition, replicate) or any table with a sample-matching column and a
 * condition column.
 */
export function applyAnnotationTable(
  samples: string[],
  table: Table,
  current: SampleAnno[],
): { annotation: SampleAnno[]; matched: number } {
  const h = table.headers.map((x) => x.toLowerCase().trim());
  const condCol = ["condition", "group", "treatment", "class"].map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1;
  const repCol = ["replicate", "rep", "bioreplicate"].map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1;
  const labelCol = ["sample_name", "label", "name"].map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1;
  if (condCol < 0) throw new Error("Annotation file needs a 'condition' column.");

  const targets = new Map(samples.map((s) => [norm(s), s]));
  let bestCol = -1;
  let bestHits = 0;
  h.forEach((_, c) => {
    if (c === condCol || c === repCol) return;
    let hits = 0;
    for (const r of table.rows) {
      const v = r[c] ?? "";
      if (targets.has(norm(v)) || targets.has(norm(v.split(/[\\/]/).pop() ?? ""))) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestCol = c;
    }
  });
  if (bestCol < 0) throw new Error("No column in the annotation file matches the sample names.");

  const byKey = new Map<string, string[]>();
  for (const r of table.rows) {
    const v = r[bestCol] ?? "";
    const key = targets.has(norm(v)) ? norm(v) : norm(v.split(/[\\/]/).pop() ?? "");
    if (targets.has(key)) byKey.set(targets.get(key)!, r);
  }
  let matched = 0;
  const annotation = current.map((a) => {
    const r = byKey.get(a.sample);
    if (!r) return a;
    matched++;
    const rep = Number(r[repCol]);
    return {
      ...a,
      condition: (r[condCol] ?? "").trim() || a.condition,
      replicate: repCol >= 0 && Number.isFinite(rep) ? rep : a.replicate,
      label: labelCol >= 0 && labelCol !== bestCol && r[labelCol]?.trim() ? r[labelCol].trim() : a.label,
    };
  });
  return { annotation, matched };
}
