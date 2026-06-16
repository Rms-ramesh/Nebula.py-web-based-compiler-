import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Code2,
  Download,
  Eraser,
  FileCode2,
  Loader2,
  Package,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
} from "lucide-react";
import "./App.css";

const EXAMPLES = {
  basics: {
    label: "Python basics",
    code: `name = "Nebula.py"
numbers = [1, 2, 3, 4, 5]

print(f"Welcome to {name}")
print("Total:", sum(numbers))
print("Squares:", [value ** 2 for value in numbers])
`,
  },
  numpy: {
    label: "NumPy array",
    code: `import numpy as np

x = np.arange(1, 6)
print("Numbers:", x)
print("Squares:", x ** 2)
print("Mean:", np.mean(x))
`,
  },
  pandas: {
    label: "Pandas frame",
    code: `import pandas as pd

scores = pd.DataFrame({
    "name": ["Ava", "Mina", "Zed"],
    "score": [92, 88, 96],
})

print(scores)
print("\\nTop score:")
print(scores.sort_values("score", ascending=False).iloc[0])
`,
  },
  matplotlib: {
    label: "Matplotlib plot",
    code: `import matplotlib.pyplot as plt

x_axis = [1, 2, 3, 4, 5]
y_axis = [2, 4, 1, 6, 3]

plt.plot(x_axis, y_axis, color="blue", marker="o", linestyle="-")
plt.xlabel("X Axis Title")
plt.ylabel("Y Axis Title")
plt.title("My First Python Plot")
plt.grid(True, linestyle="--", alpha=0.6)
plt.show()
`,
  },
  scipy: {
    label: "SciPy stats",
    code: `from scipy import stats

sample = [12, 15, 14, 19, 22, 21, 18]

print("Mean:", stats.tmean(sample))
print("Variance:", stats.tvar(sample))
print("Z-scores:", stats.zscore(sample))
`,
  },
};

const DEFAULT_CODE = EXAMPLES.numpy.code;

const PACKAGE_MAP = {
  numpy: "numpy",
  pandas: "pandas",
  matplotlib: "matplotlib",
  scipy: "scipy",
};

function detectImportedPackages(source) {
  const imports = new Set();
  const lines = source.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    for (const [moduleName, packageName] of Object.entries(PACKAGE_MAP)) {
      const importRegex = new RegExp(
        `^import\\s+(.+,\\s*)?${moduleName}(\\.|\\s|,|$)`
      );
      const fromRegex = new RegExp(`^from\\s+${moduleName}(\\.|\\s|$)`);

      if (importRegex.test(line) || fromRegex.test(line)) {
        imports.add(packageName);
      }
    }
  }

  return Array.from(imports);
}

function downloadText(filename, contents, type = "text/plain") {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [pyodide, setPyodide] = useState(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Loading Python runtime...");
  const [output, setOutput] = useState("");
  const [plots, setPlots] = useState([]);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [selectedExample, setSelectedExample] = useState("numpy");
  const [progress, setProgress] = useState(20);
  const [scrollY, setScrollY] = useState(0);

  const [code, setCode] = useState(
    () => localStorage.getItem("nebula_code") || DEFAULT_CODE
  );

  const loadedPackages = useRef(new Set());

  useEffect(() => {
    localStorage.setItem("nebula_code", code);
  }, [code]);

  useEffect(() => {
    function handleScroll() {
      setScrollY(window.scrollY);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    async function load() {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js";

      script.onload = async () => {
        setProgress(45);
        const py = await window.loadPyodide();

        setProgress(75);
        await py.runPythonAsync(`
import sys
from io import StringIO
sys.stdout = StringIO()
sys.stderr = sys.stdout
`);

        setPyodide(py);
        setReady(true);
        setProgress(100);
        setStatus("Ready");
      };

      script.onerror = () => {
        setStatus("Runtime failed to load");
        setProgress(0);
      };

      document.body.appendChild(script);
    }

    load();
  }, []);

  const packageList = useMemo(() => {
    return detectImportedPackages(code);
  }, [code]);

  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const isBusy = !ready || running;

  async function ensurePackages() {
    for (const pkg of packageList) {
      if (!loadedPackages.current.has(pkg)) {
        setStatus(`Installing ${pkg}...`);
        setProgress(58);
        await pyodide.loadPackage(pkg);
        loadedPackages.current.add(pkg);
      }
    }
  }

  async function runCode() {
    if (!ready || running) return;

    setRunning(true);
    setPlots([]);
    setProgress(64);
    setStatus("Running code...");

    const start = performance.now();

    try {
      await ensurePackages();

      await pyodide.runPythonAsync(`
import sys
from io import StringIO
sys.stdout = StringIO()
sys.stderr = sys.stdout
`);

      if (packageList.includes("matplotlib")) {
        await pyodide.runPythonAsync(`
import matplotlib
matplotlib.use("Agg", force=True)
`);
      }

      setProgress(82);
      await pyodide.runPythonAsync(code);

      const text = pyodide.runPython(`
sys.stdout.getvalue()
`);
      const plotProxy = pyodide.runPython(`
import sys
plot_images = []

if "matplotlib.pyplot" in sys.modules:
    import base64
    import io
    import matplotlib.pyplot as plt

    for figure_number in plt.get_fignums():
        figure = plt.figure(figure_number)
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", bbox_inches="tight", dpi=144)
        buffer.seek(0)
        plot_images.append(base64.b64encode(buffer.read()).decode("ascii"))

    plt.close("all")

plot_images
`);

      const plotImages = plotProxy.toJs();
      plotProxy.destroy();

      const elapsed = (performance.now() - start).toFixed(0);

      setOutput(text || "Execution finished.");
      setPlots(Array.from(plotImages));
      setProgress(100);
      setStatus(`Completed in ${elapsed} ms`);
    } catch (err) {
      setOutput(String(err));
      setPlots([]);
      setProgress(100);
      setStatus("Execution failed");
    } finally {
      setRunning(false);
    }
  }

  async function copyOutput() {
    if (!output) return;

    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1400);
  }

  function clearResults() {
    setOutput("");
    setPlots([]);
  }

  function applyExample(exampleKey) {
    setSelectedExample(exampleKey);
    setCode(EXAMPLES[exampleKey].code);
    clearResults();
  }

  function resetCode() {
    setSelectedExample("numpy");
    setCode(DEFAULT_CODE);
    clearResults();
  }

  function downloadPlot(plot, index) {
    const anchor = document.createElement("a");
    anchor.href = `data:image/png;base64,${plot}`;
    anchor.download = `nebula-plot-${index + 1}.png`;
    anchor.click();
  }

  useEffect(() => {
    function handler(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runCode();
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <div className="app-shell">
      <nav className="site-nav">
        <a className="brand" href="#home" aria-label="Nebula.py home">
          <div className="brand-mark" aria-hidden="true">
            <Code2 size={22} />
          </div>
          <div>
            <span>Nebula.py</span>
            <small>Browser Python Lab</small>
          </div>
        </a>

        <div className="nav-actions">
          <a href="#lab">Open Lab</a>
          <button className="button button-primary" onClick={runCode} disabled={isBusy}>
            {running ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            <span>{running ? "Running" : "Run"}</span>
          </button>
        </div>
      </nav>

      <header className="hero" id="home">
        <div
          className="hero-grid"
          style={{ transform: `translate3d(0, ${scrollY * 0.08}px, 0)` }}
        />
        <div
          className="hero-aurora hero-aurora-a"
          style={{ transform: `translate3d(${scrollY * 0.03}px, ${scrollY * -0.06}px, 0)` }}
        />
        <div
          className="hero-aurora hero-aurora-b"
          style={{ transform: `translate3d(${scrollY * -0.04}px, ${scrollY * 0.05}px, 0)` }}
        />

        <section className="hero-content reveal">
          <div className="hero-copy">
            <span className="eyebrow">
              <Sparkles size={16} />
              Pyodide powered coding studio
            </span>
            <h1>Nebula.py</h1>
            <p>
              A glossy, fast Python playground for experiments, charts, arrays,
              and small data stories directly in your browser.
            </p>

            <div className="hero-actions">
              <a className="button button-primary" href="#lab">
                <Play size={18} />
                Launch lab
              </a>
              <button className="button button-secondary" onClick={() => applyExample("matplotlib")}>
                <FileCode2 size={18} />
                Load plot demo
              </button>
            </div>
          </div>

          <div className="hero-preview glass-card" aria-hidden="true">
            <div className="preview-top">
              <span />
              <span />
              <span />
            </div>
            <pre>{`import matplotlib.pyplot as plt

plt.plot([1, 2, 3, 4], [3, 6, 4, 8])
plt.title("Nebula signal")
plt.show()`}</pre>
            <div className="signal-bars">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </section>
      </header>

      <section className="feature-strip reveal" aria-label="Nebula.py features">
        <article className="glass-card">
          <strong>Live packages</strong>
          <span>NumPy, Pandas, Matplotlib, and SciPy auto-load from imports.</span>
        </article>
        <article className="glass-card">
          <strong>Visual output</strong>
          <span>Matplotlib figures render as downloadable PNG previews.</span>
        </article>
        <article className="glass-card">
          <strong>IDE feel</strong>
          <span>Lightweight editing, templates, shortcuts, and saved code.</span>
        </article>
      </section>

      <main className="workspace reveal" id="lab">
        <section className="panel editor-panel" aria-labelledby="editor-title">
          <div className="panel-header editor-header">
            <div>
              <h2 id="editor-title">Nebula Lab</h2>
              <p>{lineCount} lines saved locally</p>
            </div>

            <div className="editor-tools">
              <label className="select-wrap">
                <span>Example</span>
                <select
                  value={selectedExample}
                  onChange={(event) => applyExample(event.target.value)}
                >
                  {Object.entries(EXAMPLES).map(([key, example]) => (
                    <option key={key} value={key}>
                      {example.label}
                    </option>
                  ))}
                </select>
              </label>

              <button className="icon-button" onClick={copyCode} title="Copy code">
                {copiedCode ? <CheckCircle2 size={18} /> : <Clipboard size={18} />}
              </button>
              <button
                className="icon-button"
                onClick={() => downloadText("nebula.py", code, "text/x-python")}
                title="Download Python file"
              >
                <Download size={18} />
              </button>
              <button className="icon-button" onClick={resetCode} title="Reset code">
                <RotateCcw size={18} />
              </button>
            </div>
          </div>

          <div className="editor-frame">
            <textarea
              aria-label="Python code editor"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="code-editor"
            />
          </div>
        </section>

        <aside className="side-panel">
          <section className="panel status-card" aria-live="polite">
            <div className="status-icon" data-running={running}>
              {running ? <Loader2 className="spin" size={18} /> : <Terminal size={18} />}
            </div>
            <div className="status-copy">
              <h2>Status</h2>
              <p>{status}</p>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>
          </section>

          <section className="panel package-card">
            <div className="panel-header compact">
              <div>
                <h2>Packages</h2>
                <p>Detected imports</p>
              </div>
              <Package size={18} />
            </div>

            <div className="package-list">
              {packageList.length === 0 && <span className="muted">None</span>}

              {packageList.map((pkg) => (
                <span key={pkg} className="package-pill">
                  {pkg}
                </span>
              ))}
            </div>
          </section>

          <section className="panel console-panel" aria-labelledby="console-title">
            <div className="panel-header compact">
              <div>
                <h2 id="console-title">Console</h2>
                <p>{output || plots.length ? "Latest output" : "Waiting for a run"}</p>
              </div>

              <div className="console-actions">
                <button
                  className="icon-button"
                  onClick={clearResults}
                  disabled={!output && plots.length === 0}
                  title="Clear console"
                >
                  <Eraser size={18} />
                </button>
                <button
                  className="icon-button"
                  onClick={copyOutput}
                  disabled={!output}
                  title="Copy output"
                >
                  {copied ? <CheckCircle2 size={18} /> : <Clipboard size={18} />}
                </button>
              </div>
            </div>

            <pre className={status === "Execution failed" ? "console-output error" : "console-output"}>
              {output || "Run your code to see output here."}
            </pre>

            {plots.length > 0 && (
              <div className="plot-gallery" aria-label="Generated plots">
                {plots.map((plot, index) => (
                  <figure className="plot-card" key={`${plot.slice(0, 24)}-${index}`}>
                    <img
                      alt={`Generated Python plot ${index + 1}`}
                      src={`data:image/png;base64,${plot}`}
                    />
                    <figcaption>
                      <span>Plot {index + 1}</span>
                      <button
                        className="icon-button light"
                        onClick={() => downloadPlot(plot, index)}
                        title="Download plot"
                      >
                        <Download size={16} />
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </aside>
      </main>

      <button
        className="mobile-run button button-primary"
        onClick={runCode}
        disabled={isBusy}
      >
        {running ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
        <span>{running ? "Running" : "Run code"}</span>
      </button>

      <footer className="footer-note">
        <span>Nebula.py runs locally with Pyodide.</span>
        <span>Use Ctrl + Enter or Cmd + Enter to execute code.</span>
      </footer>
    </div>
  );
}
