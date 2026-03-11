import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const liveEnabled = /^(1|true|yes)$/i.test(process.env.ASSISTANT_LIVE ?? '');
const apiKeyOverride = (process.env.ASSISTANT_LIVE_API_KEY ?? '').trim();
const liveModels = (process.env.ASSISTANT_LIVE_MODELS ?? 'gpt-5.1-codex-mini,gpt-5-mini')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const assistantNotebookFixtures = {
  extend_existing: {
    version: 1,
    id: 'nb-assistant-live-extend',
    name: 'Assistant Live Extend Fixture',
    trigMode: 'rad',
    defaultMathRenderMode: 'exact',
    updatedAt: '2026-03-11T00:00:00.000Z',
    cells: [
      {
        id: 'cell-markdown-intro',
        type: 'markdown',
        source: '# Solving x^2 = 2\n\nWe already know the equation. Extend this into a clearer teaching notebook.'
      },
      {
        id: 'cell-math-base',
        type: 'math',
        source: 'x^2 = 2',
        mathRenderMode: 'exact',
        mathTrigMode: 'rad'
      },
      {
        id: 'cell-math-solve',
        type: 'math',
        source: 'solutions := solve(x^2 = 2, x)\nsolutions',
        mathRenderMode: 'exact',
        mathTrigMode: 'rad'
      }
    ]
  },
  cleanup_delete: {
    version: 1,
    id: 'nb-assistant-live-cleanup',
    name: 'Assistant Live Cleanup Fixture',
    trigMode: 'rad',
    defaultMathRenderMode: 'exact',
    updatedAt: '2026-03-11T00:00:00.000Z',
    cells: [
      {
        id: 'cell-markdown-remove',
        type: 'markdown',
        source: '# REMOVE ME\n\nThis old section should be deleted.'
      },
      {
        id: 'cell-code-remove',
        type: 'code',
        source: 'from sympy import symbols, Eq, solve\nx = symbols("x")\nsolve(Eq(x**2, 2), x)'
      },
      {
        id: 'cell-markdown-keepish',
        type: 'markdown',
        source: '# Old notebook\n\nRewrite this into a compact CAS-first explanation.'
      },
      {
        id: 'cell-math-old',
        type: 'math',
        source: 'x^2 = 2',
        mathRenderMode: 'exact',
        mathTrigMode: 'rad'
      }
    ]
  }
} as const;

type NotebookFixture = (typeof assistantNotebookFixtures)[keyof typeof assistantNotebookFixtures];

type NotebookSnapshot = {
  id: string | null;
  name: string | null;
  cells: Array<{
    id: string;
    type: string;
    source: string;
  }>;
};

type RunObservation = {
  second: number;
  loading: number;
  validating: number;
  failed: number;
  applied: number;
  totalCells: number;
  progress: string;
};

const artifactDir = path.resolve(process.cwd(), '../output/playwright');

const sanitizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const seedNotebookFixture = async (page: any, notebook: NotebookFixture) => {
  await page.addInitScript((payload) => {
    localStorage.setItem(`sugarpy:notebook:v1:${payload.id}`, JSON.stringify(payload));
    localStorage.setItem('sugarpy:last-open', payload.id);
  }, notebook);
};

const attachBrowserErrorGuards = (page: any) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error: Error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (msg: any) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  return { pageErrors, consoleErrors };
};

const isIgnorableConsoleError = (message: string) =>
  message.includes("Access to fetch at 'http://localhost:8888/api/kernels") ||
  message.includes('Failed to load resource: net::ERR_FAILED') ||
  message.includes('Failed to load resource: the server responded with a status of 404 (Not Found)');

const expectNoGlobalErrors = async (
  page: any,
  guards: { pageErrors: string[]; consoleErrors: string[] }
) => {
  expect(guards.pageErrors).toEqual([]);
  expect(guards.consoleErrors.filter((message) => !isIgnorableConsoleError(message))).toEqual([]);
  const errors = await page.evaluate(() => (window as any).__sugarpy_errors || []);
  expect(errors).toEqual([]);
};

const configureAssistant = async (page: any, model: string) => {
  await page.getByTestId('assistant-toggle').click();
  await page.getByTestId('assistant-settings-toggle').click();
  if (apiKeyOverride) {
    await page.getByTestId('assistant-api-key').fill(apiKeyOverride);
  }
  await page.getByTestId('assistant-model').selectOption(model);
};

const readObservation = async (page: any, startedAt: number): Promise<RunObservation> =>
  page.evaluate((started) => {
    const badgeTexts = Array.from(document.querySelectorAll('.cell-assistant-badge')).map((node) =>
      (node.textContent ?? '').trim()
    );
    const progressNode = Array.from(document.querySelectorAll('.assistant-op-reason'))
      .map((node) => (node.textContent ?? '').trim())
      .find((text) => text.startsWith('Progress:'));
    return {
      second: Math.max(0, Math.floor((Date.now() - started) / 1000)),
      loading: document.querySelectorAll('.assistant-loading-line').length,
      validating: badgeTexts.filter((text) => text.includes('Assistant validating')).length,
      failed: badgeTexts.filter((text) => text.includes('Assistant failed')).length,
      applied: badgeTexts.filter((text) => text.includes('Assistant applied')).length,
      totalCells: document.querySelectorAll('[data-testid^="cell-row-"]').length,
      progress: progressNode ?? ''
    };
  }, startedAt);

const waitForAssistantRunToSettle = async (page: any, minimumApplied: number, timeoutMs: number) => {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastSignature = '';
  let stableSince = 0;
  let lastObservation: RunObservation | null = null;

  while (Date.now() < deadline) {
    const observation = await readObservation(page, startedAt);
    lastObservation = observation;
    if (observation.failed > 0) {
      throw new Error(`Assistant run failed after ${observation.second}s.`);
    }
    const signature = JSON.stringify({
      loading: observation.loading,
      validating: observation.validating,
      applied: observation.applied,
      totalCells: observation.totalCells,
      progress: observation.progress
    });
    if (signature !== lastSignature) {
      lastSignature = signature;
      stableSince = Date.now();
    }
    const isStable = Date.now() - stableSince >= 5000;
    if (
      observation.loading === 0 &&
      observation.validating === 0 &&
      observation.applied >= minimumApplied &&
      isStable
    ) {
      return observation;
    }
    await page.waitForTimeout(2000);
  }

  throw new Error(`Assistant run did not settle within ${timeoutMs}ms. Last observation: ${JSON.stringify(lastObservation)}`);
};

const readNotebookSnapshot = async (page: any): Promise<NotebookSnapshot> =>
  page.evaluate(() => {
    const notebookId = localStorage.getItem('sugarpy:last-open');
    const raw = notebookId ? localStorage.getItem(`sugarpy:notebook:v1:${notebookId}`) : null;
    if (!raw) {
      return { id: notebookId, name: null, cells: [] };
    }
    const parsed = JSON.parse(raw);
    return {
      id: parsed.id ?? notebookId,
      name: parsed.name ?? null,
      cells: Array.isArray(parsed.cells)
        ? parsed.cells.map((cell: any) => ({
            id: String(cell.id ?? ''),
            type: String(cell.type ?? 'code'),
            source: String(cell.source ?? '')
          }))
        : []
    };
  });

const collectRenderedOutputs = async (page: any) =>
  page.evaluate(() => ({
    codeCellCount: document.querySelectorAll('[data-testid="cell-row-code"]').length,
    markdownCellCount: document.querySelectorAll('[data-testid="cell-row-markdown"]').length,
    mathCellCount: document.querySelectorAll('[data-testid="cell-row-math"]').length,
    totalCellCount: document.querySelectorAll('[data-testid^="cell-row-"]').length,
    mathOutputs: Array.from(document.querySelectorAll('[data-testid="math-output"]')).map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    ),
    codeOutputs: Array.from(document.querySelectorAll('[data-testid="cell-output"]')).map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    ),
    markdownTexts: Array.from(document.querySelectorAll('.notebook-item .markdown')).map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    ),
    cellErrors: Array.from(document.querySelectorAll('[data-testid="cell-error"]')).map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    ),
    plotCount: document.querySelectorAll('[data-testid="plotly-graph"]').length,
    bodyText: (document.body.innerText ?? '').replace(/\s+/g, ' ').trim()
  }));

const collectAssistantPanelState = async (page: any) => ({
  summary: ((await page.locator('.assistant-summary').last().textContent()) ?? '').trim(),
  warnings: (await page.locator('.assistant-warning').allTextContents()).map((value) => value.trim()),
  previewVisible: await page.getByTestId('assistant-preview').isVisible()
});

const writeArtifact = async (scenario: string, model: string, payload: Record<string, unknown>) => {
  await fs.mkdir(artifactDir, { recursive: true });
  const filePath = path.join(artifactDir, `assistant-live-${sanitizeName(scenario)}-${sanitizeName(model)}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
};

const runScenario = async (params: {
  page: any;
  model: string;
  prompt: string;
  minimumApplied: number;
  timeoutMs: number;
  fixture?: NotebookFixture;
}) => {
  const { page, model, prompt, minimumApplied, timeoutMs, fixture } = params;
  const guards = attachBrowserErrorGuards(page);
  if (fixture) {
    await seedNotebookFixture(page, fixture);
  }
  await page.goto('/');
  await configureAssistant(page, model);
  await page.getByTestId('assistant-prompt').fill(prompt);
  await page.getByTestId('assistant-generate').click();
  await expect(page.getByTestId('assistant-preview')).toBeVisible({ timeout: 180000 });
  const lastObservation = await waitForAssistantRunToSettle(page, minimumApplied, timeoutMs);
  await page.waitForTimeout(1500);
  const assistant = await collectAssistantPanelState(page);
  const notebook = await readNotebookSnapshot(page);
  const rendered = await collectRenderedOutputs(page);
  await expectNoGlobalErrors(page, guards);
  return {
    assistant,
    notebook,
    rendered,
    lastObservation,
    pageErrors: guards.pageErrors,
    consoleErrors: guards.consoleErrors
  };
};

for (const model of liveModels) {
  test.describe(`Assistant live regression (${model})`, () => {
    test.skip(!liveEnabled, 'Set ASSISTANT_LIVE=1 to run live assistant regression scenarios.');

    test('creates a 10-cell notebook from scratch', async ({ page }) => {
      test.setTimeout(10 * 60_000);
      const prompt = [
        'Create a 10-cell SugarPy teaching notebook about solving x^2 = 2.',
        'Use exactly 5 markdown cells and 5 math cells, alternating and starting with markdown.',
        'Use only Markdown and Math cells.',
        'Show the equation, solve it with solve(...), verify both roots explicitly, include decimal approximations, and end with a short summary.'
      ].join(' ');
      const result = await runScenario({
        page,
        model,
        prompt,
        minimumApplied: 10,
        timeoutMs: 9 * 60_000
      });
      await writeArtifact('create-ten-cell-notebook', model, result);

      const sources = result.notebook.cells.map((cell) => cell.source).join('\n');
      expect(result.rendered.totalCellCount).toBe(10);
      expect(result.rendered.markdownCellCount).toBe(5);
      expect(result.rendered.mathCellCount).toBe(5);
      expect(result.rendered.codeCellCount).toBe(0);
      expect(result.rendered.cellErrors).toEqual([]);
      expect(sources).toContain('solve(');
      expect(sources).toContain('N(');
      expect(result.rendered.mathOutputs.length).toBeGreaterThanOrEqual(4);
      expect(result.rendered.bodyText).toContain('sqrt');
      expect(result.rendered.bodyText).toContain('1.414');
    });

    test('extends an existing notebook without breaking earlier cells', async ({ page }) => {
      test.setTimeout(9 * 60_000);
      const prompt = [
        'Extend the current notebook into exactly 8 cells total.',
        'Keep the existing introduction and the existing solve flow.',
        'Use only Markdown and Math cells.',
        'Add a verification section for both roots, add decimal approximations, and finish with a short summary for students.'
      ].join(' ');
      const result = await runScenario({
        page,
        model,
        prompt,
        minimumApplied: 5,
        timeoutMs: 8 * 60_000,
        fixture: assistantNotebookFixtures.extend_existing
      });
      await writeArtifact('extend-existing-notebook', model, result);

      const sources = result.notebook.cells.map((cell) => cell.source).join('\n');
      expect(result.rendered.totalCellCount).toBe(8);
      expect(result.rendered.codeCellCount).toBe(0);
      expect(result.rendered.markdownCellCount).toBeGreaterThanOrEqual(4);
      expect(result.rendered.mathCellCount).toBeGreaterThanOrEqual(4);
      expect(result.rendered.cellErrors).toEqual([]);
      expect(sources).toContain('solve(');
      expect(sources).toContain('N(');
      expect(result.rendered.bodyText).toContain('1.414');
      expect(result.rendered.mathOutputs.length).toBeGreaterThanOrEqual(3);
    });

    test('rewrites an existing notebook and deletes obsolete parts', async ({ page }) => {
      test.setTimeout(9 * 60_000);
      const prompt = [
        'Rewrite the current notebook into exactly 3 cells total: 1 markdown cell and 2 math cells.',
        'Delete the Python helper code cell.',
        'Delete every section marked REMOVE ME.',
        'Keep the result CAS-first and student-friendly.'
      ].join(' ');
      const result = await runScenario({
        page,
        model,
        prompt,
        minimumApplied: 3,
        timeoutMs: 8 * 60_000,
        fixture: assistantNotebookFixtures.cleanup_delete
      });
      await writeArtifact('cleanup-and-delete', model, result);

      const sources = result.notebook.cells.map((cell) => cell.source).join('\n');
      expect(result.rendered.totalCellCount).toBe(3);
      expect(result.rendered.markdownCellCount).toBe(1);
      expect(result.rendered.mathCellCount).toBe(2);
      expect(result.rendered.codeCellCount).toBe(0);
      expect(result.rendered.cellErrors).toEqual([]);
      expect(sources).not.toContain('REMOVE ME');
      expect(sources).not.toContain('from sympy import');
      expect(sources).toContain('solve(');
    });
  });
}
