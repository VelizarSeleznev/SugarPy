import React from 'react';

const mathExamples = [
  '2 + 2',
  'x^2 + 2x + 1',
  'x^2 = 2',
  'a := 5',
  'sin(30)'
];

const codeExamples = [
  'def f(x):',
  '    return x**2 + 1',
  '',
  'f(3)'
];

const chemistryExamples = [
  'from sugarpy.chem import balance_equation',
  "balance_equation('Fe + O2 -> Fe2O3')",
  '',
  'from sugarpy.stoichiometry import render_stoichiometry',
  "render_stoichiometry('H2 + O2 -> H2O', {'H2': {'n': 2}})"
];

const geometryTaskSteps = [
  'c1 := (x - 5)^2 + (y - 5)^2 - 36',
  'c2 := (x + 1)^2 + (y - 2)^2 - 36',
  'line := expand(c1 - c2)',
  'solve(Eq(line, 0), y)',
  'solve((Eq(c1, 0), Eq(c2, 0)), (x, y))'
];

function ExampleBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="wiki-pre">
      <code>{lines.join('\n')}</code>
    </pre>
  );
}

export function WikiPage() {
  return (
    <div className="wiki-page">
      <header className="wiki-header">
        <h1 className="wiki-title">SugarPy Wiki</h1>
        <p className="wiki-subtitle">
          Teacher-first quick reference for the core classroom workflow.
        </p>
        <a className="button secondary" href="/" target="_blank" rel="noreferrer">
          Open Notebook
        </a>
      </header>

      <section className="wiki-section">
        <h2>What SugarPy can do</h2>
        <ul>
          <li>Write code in Python, C, Go, or PHP in notebook-style code cells.</li>
          <li>Evaluate CAS-style math in Math cells.</li>
          <li>Render formulas and Plotly graphs.</li>
          <li>Balance reactions and compute stoichiometry (optional chemistry flow).</li>
        </ul>
      </section>

      <section className="wiki-section">
        <h2>Cell types</h2>
        <ul>
          <li>`Code`: language-selectable editor (`Python`, `C`, `Go`, `PHP`). Execution supports `Python` and `PHP` (`php` CLI or `podman` + `php:8.3-cli`).</li>
          <li>`Math`: fast symbolic math using `=`, `:=`, `^`, implicit multiplication.</li>
          <li>`Stoichiometry`: interactive chemistry reaction table.</li>
          <li>`Text`: lesson notes and explanations.</li>
        </ul>
      </section>

      <section className="wiki-section">
        <h2>Math workflow</h2>
        <p>Use Math cells for quick symbolic operations and equations.</p>
        <ExampleBlock lines={mathExamples} />
        <p>
          Notes: `=` means equation, `:=` means assignment. Trig mode can be switched between
          Degrees and Radians.
        </p>
      </section>

      <section className="wiki-section">
        <h2>Code workflow</h2>
        <p>Use Python Code cells to define functions, then reuse them in Math cells.</p>
        <ExampleBlock lines={codeExamples} />
      </section>

      <section className="wiki-section">
        <h2>Multi-step math problem</h2>
        <p>
          Example: solve intersections of two circles by reducing the system to a line and then
          substituting back.
        </p>
        <ExampleBlock lines={geometryTaskSteps} />
        <p>
          Result for the sample task:
          <br />
          `(2 - 3*sqrt(55)/10, 7/2 + 3*sqrt(55)/5)` and
          <br />
          `(2 + 3*sqrt(55)/10, 7/2 - 3*sqrt(55)/5)`.
        </p>
      </section>

      <section className="wiki-section">
        <h2>Optional chemistry workflow</h2>
        <p>Use direct helpers in Code cells or the Stoichiometry cell from Function Library.</p>
        <ExampleBlock lines={chemistryExamples} />
      </section>

      <section className="wiki-section">
        <h2>Troubleshooting</h2>
        <ul>
          <li>If execution fails, check that Jupyter is running at `http://localhost:8888`.</li>
          <li>If Math parsing fails, check brackets and use a single top-level `=`.</li>
          <li>If chemistry input fails, verify reaction arrow (`-&gt;` or `=`) and formula syntax.</li>
        </ul>
      </section>
    </div>
  );
}
