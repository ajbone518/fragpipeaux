# FragPipe Aux

A modern, fully in-browser take on [FragPipe-Analyst](https://fragpipe-analyst.nesvilab.org/): downstream statistics and visualisation for FragPipe proteomics output.

Drop in `combined_protein.tsv` and get QC, PCA, differential expression, clustered heatmaps and publication-ready figures in seconds. There's no R, no server and no upload: all computation happens in your browser tab, so data never leaves your machine.

## What it does

| Step | Details |
|---|---|
| **Inputs** | FragPipe LFQ `combined_protein.tsv` (MaxLFQ, intensity or spectral counts), TMT-Integrator `abundance_/ratio_protein_*.tsv`, DIA-NN `report.pg_matrix.tsv`, or any generic CSV/TSV matrix. Formats are auto-detected. |
| **Experiment design** | Conditions are inferred from sample names, or applied from FragPipe's `experiment_annotation.tsv`. Edit labels, conditions and replicates inline, and exclude samples. |
| **Filtering** | Contaminant removal, minimum peptides/PSMs, and missing-value filters (per condition, every condition, or fraction of samples). A live filtering funnel shows what remains. |
| **Normalisation** | None, median centring, or quantile normalisation (tolerant of missing values). |
| **Imputation** | Perseus-style left-shifted Gaussian (seeded, reproducible), MinDet, k-nearest neighbours, or none. |
| **Statistics** | Per-protein group-means linear model with **limma-style empirical-Bayes moderated t-tests**, or ordinary t-tests. Benjamini–Hochberg FDR. Comparisons can be versus control, all pairs, or custom. |
| **QC** | Proteins per sample, intensity distributions before/after normalisation, protein coverage, clustered sample correlation, CV per condition, missing-value pattern, observed-vs-imputed densities. |
| **Exploration** | Interactive PCA (any PC pair, top-N variable proteins, scree plot). Volcano plots with hover, gene search, smart non-overlapping labels and click-to-inspect. Clustered z-score heatmaps with dendrograms. A per-protein detail drawer (imputed values shown hollow). |
| **Figure editing** | A **Customize** panel on each chart sets the title, axis labels, axis ranges, width × height, font size, point size and gridlines. It also covers volcano colours, the heatmap colour-scale limit and row labels, and condition colours (which apply to all charts). Settings are remembered per chart and carried into SVG/PNG exports. |
| **Export** | SVG/PNG for every chart, results TSV (all comparisons side by side), normalised/imputed matrices, `parameters.json` for reproducibility, and an auto-generated **methods paragraph**. One click sends significant gene lists to Enrichr. |

### Compared with FragPipe-Analyst

- **Private and instant.** It's a static site with no server-side R or Shiny session and no upload limit. Every setting change re-runs the whole pipeline immediately.
- **Interactive.** Hovering, searching and clicking work across every plot, and selecting a protein anywhere opens its details.
- **Modern UI.** Light and dark themes, a responsive layout that works on a phone, and colour-blind-aware palettes with shape as a second encoding.
- **Reproducible.** It exports every parameter, uses a seeded imputation RNG, and writes the methods text for you.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # static site in dist/ — host anywhere (GitHub Pages, S3, a lab server)
npm test           # statistics + pipeline tests
```

### Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push to `main` (or on demand from the Actions tab).

To set it up once, open **Settings → Pages** and set **Source** to **GitHub Actions**. The site is then served at `https://<owner>.github.io/fragpipeaux/`. Asset paths are relative, so the build works under that sub-path without extra configuration.

Click **Try with demo data** for a synthetic three-condition experiment with a planted interferon response (Treated) and a cell-cycle loss (Knockout).

## Statistics notes

- **Model:** a `~0 + condition` linear model per protein. Missing values (when not imputed) are dropped per protein, as `limma::lmFit` does.
- **Moderation:** residual variances are squeezed towards a scaled-F prior, estimated by limma's `fitFDist` method of moments with per-protein degrees of freedom. The moderated t uses `df_residual + df_prior`.
- **Validation:** special functions, t-distribution p-values, BH adjustment and the pooled t-test are checked against scipy reference values, and the eBayes prior is checked by simulation (`src/lib/stats.test.ts`).
- **Imputation caveat:** Perseus/MinDet imputation assumes values are missing because the protein is low in abundance (MNAR). An abundant protein with a random dropout gets a very low imputed value, which inflates its variance. If your missingness is mostly random, use kNN or no imputation.

## Project layout

```
src/lib/parse.ts      input detection & parsing, annotation matching
src/lib/pipeline.ts   filtering, normalisation, imputation, model fits, PCA, clustering
src/lib/stats.ts      special functions, t distribution, eBayes moderation, BH
src/lib/demo.ts       synthetic demo dataset
src/charts/           dependency-free SVG charts (React)
src/views/            app screens
```

The only runtime dependencies are React and React DOM.
