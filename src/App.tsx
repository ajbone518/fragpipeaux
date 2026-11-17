import { useEffect, useState, type ReactNode } from "react";
import { useAnalysis } from "./state";
import { Icon, Logo } from "./components/ui";
import { DataView, ProcessingView, SamplesView } from "./views/setup";
import { DEView, ExportView, HeatmapView, PCAView, ProteinPanel, QCView } from "./views/results";

type View = "data" | "samples" | "processing" | "qc" | "pca" | "de" | "heatmap" | "export";

const NAV: { group: string; items: { id: View; label: string; icon: (s?: number) => ReactNode }[] }[] = [
  { group: "Setup", items: [
    { id: "data", label: "Data", icon: Icon.upload },
    { id: "samples", label: "Samples", icon: Icon.table },
    { id: "processing", label: "Processing", icon: Icon.sliders },
  ] },
  { group: "Results", items: [
    { id: "qc", label: "Quality control", icon: Icon.gauge },
    { id: "pca", label: "PCA", icon: Icon.scatter },
    { id: "de", label: "Differential", icon: Icon.volcano },
    { id: "heatmap", label: "Heatmap", icon: Icon.grid },
    { id: "export", label: "Export", icon: Icon.download },
  ] },
];

type Theme = "system" | "light" | "dark";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("fpa-theme") as Theme) || "system"; } catch { return "system"; }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") delete el.dataset.theme;
    else el.dataset.theme = theme;
    try { localStorage.setItem("fpa-theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme];
}

export default function App() {
  const a = useAnalysis();
  const [view, setView] = useState<View>("data");
  const [theme, setTheme] = useTheme();

  const enabled = (v: View) => {
    if (v === "data") return true;
    if (!a.dataset) return false;
    if (v === "samples") return true;
    if (v === "processing") return a.conditions.length >= 1;
    if (v === "qc") return !!a.proc;
    return !!a.proc && a.results.length > 0;
  };
  const current = enabled(view) ? view : "data";
  const go = (v: View) => { setView(v); window.scrollTo({ top: 0 }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") a.setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a]);

  const navButtons = (mobile: boolean) =>
    NAV.flatMap((g) => g.items).map((it, k) => (
      <button key={it.id} className={`nav-item ${current === it.id ? "active" : ""}`} disabled={!enabled(it.id)} onClick={() => go(it.id)}>
        {k < 3 && !mobile ? <span className={`num ${enabled(NAV[0].items[k + 1]?.id ?? "qc") && k < 2 ? "done" : ""}`}>{k + 1}</span> : it.icon(17)}
        {it.label}
      </button>
    ));

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <div className="brand-mark"><Logo /></div>
          <div>
            <div className="brand-name">FragPipe Aux</div>
            <div className="brand-sub">Proteomics analysis</div>
          </div>
        </div>
        {NAV.map((g, gi) => (
          <div className="nav-group" key={g.group}>
            <div className="nav-label">{g.group}</div>
            {navButtons(false).slice(gi === 0 ? 0 : 3, gi === 0 ? 3 : undefined)}
          </div>
        ))}
        <div className="sidebar-foot">
          <div className="seg" aria-label="Theme">
            {(["system", "light", "dark"] as Theme[]).map((t) => (
              <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)} title={`${t} theme`}>
                {t === "light" ? Icon.sun(14) : t === "dark" ? Icon.moon(14) : "Auto"}
              </button>
            ))}
          </div>
          {a.dataset && <button className="btn ghost sm" style={{ justifyContent: "flex-start" }} onClick={() => { a.reset(); go("data"); }}>Start over</button>}
          <span className="row" style={{ gap: 6 }}>{Icon.lock(12)} Runs entirely in your browser</span>
        </div>
      </nav>

      <div>
        <div className="mobile-nav">{navButtons(true)}</div>
        <main className="main">
          {current === "data" && <DataView a={a} next={() => go("samples")} />}
          {current === "samples" && <SamplesView a={a} next={() => go("processing")} />}
          {current === "processing" && <ProcessingView a={a} next={() => go("qc")} />}
          {current === "qc" && <QCView a={a} />}
          {current === "pca" && <PCAView a={a} />}
          {current === "de" && <DEView a={a} />}
          {current === "heatmap" && <HeatmapView a={a} />}
          {current === "export" && <ExportView a={a} />}
        </main>
      </div>
      <ProteinPanel a={a} />
      {a.computing && <div className="busy">Updating…</div>}
    </div>
  );
}
