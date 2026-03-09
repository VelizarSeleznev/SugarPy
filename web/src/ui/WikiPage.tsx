import React from 'react';

const quickStartExamples = ['x^2 = 2', 'solve(x^2 = 2, x)', 'a := 5', 'sin(30)', 'plot(sin(x), xmin=-6, xmax=6)'];

const casPatterns = [
  'expand((x - 1)(x + 2))',
  'factor(x^2 - 1)',
  'solve(2x + 3 = 11, x)',
  'N(sqrt(2))',
  'diff(sin(x), x)'
];

const codeExamples = ['def f(x):', '    return x**2 + 1', '', 'f(3)'];

const geometryTaskSteps = [
  'c1 := (x - 5)^2 + (y - 5)^2 - 36',
  'c2 := (x + 1)^2 + (y - 2)^2 - 36',
  'line := expand(c1 - c2)',
  'solve(Eq(line, 0), y)',
  'solve((Eq(c1, 0), Eq(c2, 0)), (x, y))'
];

const plotStarter = [
  'plot(',
  '  sin(x),',
  '  xmin=-6,',
  '  xmax=6,',
  "  title='Sine curve'",
  ')'
];

const plotGeometry = [
  'circle := (x - 2)^2 + (y - 30)^2 = 60',
  'plot(circle, xmin=-8, xmax=12)'
];

const plotGeometryBranches = [
  'plot(',
  '  -1 + sqrt(9 - (x - 3)^2),',
  '  -1 - sqrt(9 - (x - 3)^2),',
  '  1 + sqrt(4 - (x - 4)^2),',
  '  1 - sqrt(4 - (x - 4)^2),',
  '  xmin=0,',
  '  xmax=8,',
  '  equal_axes=True,',
  "  title='Circle check'",
  ')'
];

const ipadPatterns = [
  'Tap a rendered Math card to edit it.',
  'Use the shortcut bar for ^2, sqrt(), solve(), N(), and plot().',
  'Swipe left on a cell to move or delete it.',
  'Use Shift+Enter when a keyboard is attached.'
];

const plotRules = [
  '`xmin` / `xmax`: set the initial visible x-range.',
  '`ymin` / `ymax`: optionally pin the initial visible y-range.',
  '`title`: optional plot title. Leave it out for a cleaner graph.',
  '`equal_axes=True`: keep one unit on x equal to one unit on y. Use this for circles, geometry, and distance problems.',
  '`showlegend=True|False`: force the legend on or off.'
];

const graphControls = [
  'Scroll or pinch to zoom.',
  'Drag to pan.',
  'Double-click to reset to the initial view.',
  'Use `equal_axes=True` if a circle should look like a circle.'
];

function ExampleBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="wiki-pre">
      <code>{lines.join('\n')}</code>
    </pre>
  );
}

function WikiCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="wiki-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function WikiPage() {
  return (
    <div className="wiki-page">
      <header className="wiki-header">
        <div className="wiki-kicker">SugarPy CAS Guide</div>
        <h1 className="wiki-title">Math cells and plots without guesswork</h1>
        <p className="wiki-subtitle">
          Quick reference for CAS input, plotting, and the defaults that matter in class.
        </p>
        <div className="wiki-header-actions">
          <a className="button secondary" href="/" target="_blank" rel="noreferrer">
            Open Notebook
          </a>
        </div>
      </header>

      <div className="wiki-grid">
        <WikiCard title="Math cell quick start">
          <ul>
            <li>Use `=` for equations.</li>
            <li>Use `:=` for assignment.</li>
            <li>Use `^` for powers and implicit multiplication like `2x`.</li>
            <li>Tap a rendered Math card to reopen the raw CAS input.</li>
          </ul>
          <ExampleBlock lines={quickStartExamples} />
        </WikiCard>

        <WikiCard title="Common CAS patterns">
          <p>These are the shortest useful patterns to remember when teaching or sketching live.</p>
          <ExampleBlock lines={casPatterns} />
        </WikiCard>

        <WikiCard title="Code to Math flow">
          <p>Define helpers in Code cells, then call them from Math cells.</p>
          <ExampleBlock lines={codeExamples} />
        </WikiCard>

        <WikiCard title="Multi-step example">
          <p>Use one Math cell when you want a visible symbolic trace of several steps.</p>
          <ExampleBlock lines={geometryTaskSteps} />
        </WikiCard>
      </div>

      <WikiCard title="Plot quick start">
        <p>Start with one or more expressions, then set the view you want students to see first.</p>
        <ExampleBlock lines={plotStarter} />
      </WikiCard>

      <div className="wiki-grid">
        <WikiCard title="Plot parameters">
          <ul>
            {plotRules.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </WikiCard>

        <WikiCard title="Graph controls">
          <ul>
            {graphControls.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </WikiCard>
      </div>

      <WikiCard title="Geometry and circles">
        <p>The simplest path is to store the equation and then plot it directly.</p>
        <ExampleBlock lines={plotGeometry} />
        <p>If you need explicit branches, this still works too.</p>
        <ExampleBlock lines={plotGeometryBranches} />
      </WikiCard>

      <div className="wiki-grid">
        <WikiCard title="Practical plotting tips">
          <ul>
            <li>Always set `xmin` and `xmax` so the first view is informative.</li>
            <li>For restricted domains like `sqrt(...)`, missing pieces usually mean the expression is outside its domain.</li>
            <li>Use a title only when it helps the reader; otherwise the cleaner default looks better.</li>
            <li>If the legend adds noise, set `showlegend=False`.</li>
          </ul>
        </WikiCard>

        <WikiCard title="Using SugarPy on iPad">
          <ul>
            {ipadPatterns.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </WikiCard>
      </div>

      <WikiCard title="Troubleshooting">
        <ul>
          <li>If execution fails, check that Jupyter is running at `http://localhost:8888`.</li>
          <li>If Math parsing fails, check brackets and use a single top-level `=`.</li>
          <li>If the graph shape looks wrong for geometry, add `equal_axes=True`.</li>
          <li>If the first view is unhelpful, tighten `xmin` / `xmax` and optionally `ymin` / `ymax`.</li>
        </ul>
      </WikiCard>
    </div>
  );
}
