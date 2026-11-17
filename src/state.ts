import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { applyAnnotationTable, buildDataset, inferAnnotation, parseTable, type Dataset, type SampleAnno } from "./lib/parse";
import {
  defaultContrasts, defaultParams, differential, process, type ContrastResult, type Params, type Processed,
} from "./lib/pipeline";
import { demoFiles } from "./lib/demo";
import { seriesColor } from "./charts/core";

export type ContrastMode = "control" | "pairwise" | "custom";

export interface Analysis {
  dataset: Dataset | null;
  annotation: SampleAnno[];
  params: Params;
  contrastMode: ContrastMode;
  control: string;
  proc: Processed | null;
  results: ContrastResult[];
  error: string | null;
  computing: boolean;
  /** conditions with at least one included sample, in order of first appearance */
  conditions: string[];
  condColor: (c: string) => string;
  condShape: (c: string) => number;
  /** user-chosen condition colours (hex), overriding the default palette */
  colorOverrides: Record<string, string>;
  setConditionColor: (c: string, color: string | null) => void;
  selected: number | null; // dataset protein index
  setSelected: (i: number | null) => void;
  /** Load a protein table, optionally with an annotation table; returns a status message. */
  loadText: (text: string, name: string, annotationText?: string) => string;
  loadAnnotation: (text: string) => string;
  loadDemo: () => void;
  reset: () => void;
  setAnnotation: (a: SampleAnno[]) => void;
  setParams: (p: Partial<Params>) => void;
  setContrastMode: (m: ContrastMode) => void;
  setControl: (c: string) => void;
}

export function useAnalysis(): Analysis {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [annotation, setAnnotation] = useState<SampleAnno[]>([]);
  const [params, setParamsState] = useState<Params>(defaultParams(""));
  const [contrastMode, setContrastMode] = useState<ContrastMode>("control");
  const [control, setControl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("fpa-condition-colors-v1") || "{}"); } catch { return {}; }
  });
  const setConditionColor = useCallback((c: string, color: string | null) => {
    setColorOverrides((old) => {
      const next = { ...old };
      if (color) next[c] = color;
      else delete next[c];
      try { localStorage.setItem("fpa-condition-colors-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const conditions = useMemo(() => [...new Set(annotation.filter((a) => a.include).map((a) => a.condition))], [annotation]);
  const effectiveControl = conditions.includes(control) ? control : conditions[0] ?? "";

  const contrasts = useMemo<[string, string][]>(() => {
    if (contrastMode === "custom") return params.contrasts.filter(([a, b]) => conditions.includes(a) && conditions.includes(b) && a !== b);
    return defaultContrasts(conditions, contrastMode, effectiveControl);
  }, [contrastMode, params.contrasts, conditions, effectiveControl]);

  // Defer heavy recomputation so form inputs stay responsive.
  const dAnno = useDeferredValue(annotation);
  const dParams = useDeferredValue(params);
  const computing = dAnno !== annotation || dParams !== params;

  const procKey = [dParams.quantKey, dParams.removeContaminants, dParams.minPeptides, dParams.missingMode, dParams.minValid, dParams.normalization, dParams.imputation, dParams.shift, dParams.width, dParams.seed].join("|");
  const proc = useMemo(() => {
    if (!dataset || !dAnno.length) return null;
    const conds = new Set(dAnno.filter((a) => a.include).map((a) => a.condition));
    if (dAnno.filter((a) => a.include).length < 2 || conds.size < 1) return null;
    try {
      return process(dataset, dAnno, dParams);
    } catch (e) {
      console.error(e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, dAnno, procKey]);

  const results = useMemo(() => {
    if (!proc) return [];
    return differential(proc, { ...dParams, contrasts });
  }, [proc, dParams, contrasts]);

  const loadText = useCallback((text: string, name: string, annotationText?: string) => {
    try {
      const ds = buildDataset(parseTable(text), name);
      if (!ds.samples.length || !ds.quantTypes.length) throw new Error("No quantitative sample columns were found in this file.");
      if (!ds.ids.length) throw new Error("The file has no protein rows.");
      let anno = inferAnnotation(ds.samples);
      let msg = "";
      if (annotationText) {
        try {
          const r = applyAnnotationTable(ds.samples, parseTable(annotationText), anno);
          anno = r.annotation;
          msg = `Annotation matched ${r.matched} of ${ds.samples.length} samples.`;
        } catch (e) {
          msg = `Annotation not applied: ${e instanceof Error ? e.message : e}`;
        }
      }
      setDataset(ds);
      setAnnotation(anno);
      setParamsState({ ...defaultParams(ds.quantTypes[0].key), ...(ds.samples.length < 6 ? { minValid: 1 } : {}) });
      setContrastMode("control");
      setControl("");
      setSelected(null);
      setError(null);
      return msg;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return "";
    }
  }, []);

  const loadAnnotation = useCallback(
    (text: string) => {
      if (!dataset) return "Load a protein table first.";
      try {
        const { annotation: a, matched } = applyAnnotationTable(dataset.samples, parseTable(text), annotation);
        setAnnotation(a);
        return `Matched ${matched} of ${dataset.samples.length} samples.`;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [dataset, annotation],
  );

  const loadDemo = useCallback(() => {
    const { proteins, annotation: anno } = demoFiles();
    const ds = buildDataset(parseTable(proteins), "Demo · interferon response (synthetic)");
    setDataset(ds);
    setAnnotation(applyAnnotationTable(ds.samples, parseTable(anno), inferAnnotation(ds.samples)).annotation);
    setParamsState(defaultParams(ds.quantTypes[0].key));
    setContrastMode("control");
    setControl("Control");
    setSelected(null);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setDataset(null);
    setAnnotation([]);
    setSelected(null);
    setError(null);
  }, []);

  const condColor = useCallback((c: string) => colorOverrides[c] ?? seriesColor(conditions.indexOf(c)), [conditions, colorOverrides]);
  const condShape = useCallback((c: string) => Math.max(0, conditions.indexOf(c)), [conditions]);

  return {
    dataset,
    annotation,
    params: { ...params, contrasts },
    contrastMode,
    control: effectiveControl,
    proc,
    results,
    error,
    computing,
    conditions,
    condColor,
    condShape,
    colorOverrides,
    setConditionColor,
    selected,
    setSelected,
    loadText,
    loadAnnotation,
    loadDemo,
    reset,
    setAnnotation,
    setParams: (p) => setParamsState((old) => ({ ...old, ...p })),
    setContrastMode: (m) => {
      if (m === "custom" && contrastMode !== "custom") setParamsState((old) => ({ ...old, contrasts }));
      setContrastMode(m);
    },
    setControl,
  };
}
