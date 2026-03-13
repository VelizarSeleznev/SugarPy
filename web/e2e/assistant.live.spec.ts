import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const liveEnabled = /^(1|true|yes)$/i.test(process.env.ASSISTANT_LIVE ?? '');
const apiKeyOverride = (process.env.ASSISTANT_LIVE_API_KEY ?? '').trim();
const providerApiKeys = {
  openai: (process.env.ASSISTANT_LIVE_OPENAI_API_KEY ?? '').trim(),
  gemini: (process.env.ASSISTANT_LIVE_GEMINI_API_KEY ?? '').trim(),
  groq: (process.env.ASSISTANT_LIVE_GROQ_API_KEY ?? '').trim()
} as const;
const liveModels = (
  process.env.ASSISTANT_LIVE_MODELS ??
  'gpt-5-mini,gpt-5.1-codex-mini,gemini-3.1-flash-lite-preview,moonshotai/kimi-k2-instruct-0905'
)
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
  previewVisible: boolean;
  draftInteractive: boolean;
  failedValidationCount: number;
  totalCells: number;
};

type AssistantProvider = 'gemini' | 'groq' | 'openai';

const artifactDir = path.resolve(process.cwd(), '../output/playwright');

const sanitizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const detectProvider = (model: string): AssistantProvider => {
  const normalized = model.toLowerCase();
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('kimi-k2') || normalized.startsWith('moonshotai/')) return 'groq';
  return 'openai';
};

const getApiKeyForModel = (model: string) => {
  if (apiKeyOverride) return apiKeyOverride;
  return providerApiKeys[detectProvider(model)];
};

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
  const apiKey = getApiKeyForModel(model);
  if (!apiKey) {
    throw new Error(`No live API key configured for model ${model}.`);
  }
  await page.getByTestId('assistant-api-key').fill(apiKey);
  await page.getByTestId('assistant-model').selectOption(model);
};

const readObservation = async (page: any, startedAt: number): Promise<RunObservation> =>
  page.evaluate((started) => {
    const validationRows = Array.from(document.querySelectorAll('.assistant-preview .assistant-op-reason')).map((node) =>
      (node.textContent ?? '').trim()
    );
    return {
      second: Math.max(0, Math.floor((Date.now() - started) / 1000)),
      loading: document.querySelectorAll('.assistant-loading-line').length,
      previewVisible: !!document.querySelector('[data-testid="assistant-preview"]'),
      draftInteractive: (() => {
        const rejectButton = document.querySelector('[data-testid="assistant-reject-draft"]') as HTMLButtonElement | null;
        return !!rejectButton && !rejectButton.disabled;
      })(),
      failedValidationCount: validationRows.filter((text) => text.includes('failed')).length,
      totalCells: document.querySelectorAll('[data-testid^="cell-row-"]').length
    };
  }, startedAt);

const waitForAssistantDraftToSettle = async (page: any, initialCellCount: number, timeoutMs: number) => {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastSignature = '';
  let stableSince = 0;
  let lastObservation: RunObservation | null = null;

  while (Date.now() < deadline) {
    const observation = await readObservation(page, startedAt);
    lastObservation = observation;
    const signature = JSON.stringify({
      loading: observation.loading,
      previewVisible: observation.previewVisible,
      draftInteractive: observation.draftInteractive,
      failedValidationCount: observation.failedValidationCount,
      totalCells: observation.totalCells
    });
    if (signature !== lastSignature) {
      lastSignature = signature;
      stableSince = Date.now();
    }
    const isStable = Date.now() - stableSince >= 5000;
    if (observation.previewVisible && observation.draftInteractive && observation.totalCells === initialCellCount && isStable) {
      return observation;
    }
    await page.waitForTimeout(2000);
  }

  throw new Error(`Assistant draft did not settle within ${timeoutMs}ms. Last observation: ${JSON.stringify(lastObservation)}`);
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
  validation: (await page.locator('.assistant-preview .assistant-op-reason').allTextContents()).map((value) => value.trim()),
  previewVisible: await page.getByTestId('assistant-preview').isVisible(),
  acceptAllDisabled: await page.getByTestId('assistant-accept-all').isDisabled(),
  enabledStepAcceptCount: await page.locator('button:has-text("Accept step"):not([disabled])').count()
});

const readVisibleNotebookSignature = async (page: any) =>
  page.evaluate(() =>
    JSON.stringify(
      Array.from(document.querySelectorAll('[data-testid^="cell-row-"]')).map((node) => ({
        testId: node.getAttribute('data-testid') || '',
        text: (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      }))
    )
  );

const waitForNotebookChangeAfterAccept = async (page: any, initialSignature: string, timeoutMs: number) => {
  await expect
    .poll(
      async () => readVisibleNotebookSignature(page),
      { timeout: timeoutMs }
    )
    .not.toBe(initialSignature);
};

const runAllCells = async (page: any) => {
  const runAllButton = page.getByRole('button', { name: 'Run All' });
  if (!(await runAllButton.isVisible())) return;
  await runAllButton.click();
  await page.waitForTimeout(8000);
};

const writeArtifact = async (scenario: string, model: string, payload: Record<string, unknown>) => {
  await fs.mkdir(artifactDir, { recursive: true });
  const filePath = path.join(artifactDir, `assistant-live-${sanitizeName(scenario)}-${sanitizeName(model)}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
};

const acceptFirstStepIfPossible = async (page: any, initialNotebook: NotebookSnapshot) => {
  const enabledButtons = page.locator('button:has-text("Accept step"):not([disabled])');
  const enabledCount = await enabledButtons.count();
  if (enabledCount < 2) {
    return { attempted: false, enabledCount };
  }
  const initialSignature = await readVisibleNotebookSignature(page);
  await enabledButtons.first().click();
  await waitForNotebookChangeAfterAccept(page, initialSignature, 30_000);
  await expect(page.getByTestId('assistant-preview')).toBeVisible();
  const afterPartial = await readNotebookSnapshot(page);
  return {
    attempted: true,
    enabledCount,
    remainingPreviewVisible: await page.getByTestId('assistant-preview').isVisible(),
    remainingAcceptAllDisabled: await page.getByTestId('assistant-accept-all').isDisabled(),
    statusText: ((await page.locator('.assistant-message.assistant .assistant-text').last().textContent()) ?? '').trim(),
    notebookAfterPartial: afterPartial
  };
};

const runScenario = async (params: {
  page: any;
  model: string;
  prompt: string;
  timeoutMs: number;
  fixture?: NotebookFixture;
  checkRejectFirst?: boolean;
  checkPartialAccept?: boolean;
}) => {
  const { page, model, prompt, timeoutMs, fixture, checkRejectFirst = false, checkPartialAccept = false } = params;
  const guards = attachBrowserErrorGuards(page);
  if (fixture) {
    await seedNotebookFixture(page, fixture);
  }
  await page.goto('/');
  await configureAssistant(page, model);
  const initialNotebook = await readNotebookSnapshot(page);
  const initialVisibleSignature = await readVisibleNotebookSignature(page);
  await page.getByTestId('assistant-prompt').fill(prompt);
  await page.getByTestId('assistant-generate').click();
  await expect(page.getByTestId('assistant-preview')).toBeVisible({ timeout: 180000 });
  let lastObservation = await waitForAssistantDraftToSettle(page, initialNotebook.cells.length, timeoutMs);
  let notebookBeforeAccept = await readNotebookSnapshot(page);
  expect(notebookBeforeAccept.cells).toEqual(initialNotebook.cells);

  if (checkRejectFirst) {
    await page.getByTestId('assistant-reject-draft').click();
    await expect(page.getByTestId('assistant-preview')).toHaveCount(0);
    const notebookAfterReject = await readNotebookSnapshot(page);
    expect(notebookAfterReject.cells).toEqual(initialNotebook.cells);
    await page.getByTestId('assistant-prompt').fill(prompt);
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible({ timeout: 180000 });
    lastObservation = await waitForAssistantDraftToSettle(page, initialNotebook.cells.length, timeoutMs);
    notebookBeforeAccept = await readNotebookSnapshot(page);
    expect(notebookBeforeAccept.cells).toEqual(initialNotebook.cells);
  }

  const assistant = await collectAssistantPanelState(page);
  const partialAccept = checkPartialAccept ? await acceptFirstStepIfPossible(page, initialNotebook) : { attempted: false };
  const notebookBeforeFinalAccept = await readVisibleNotebookSignature(page);
  await page.getByTestId('assistant-accept-all').click();
  await waitForNotebookChangeAfterAccept(page, notebookBeforeFinalAccept, 30000);
  await runAllCells(page);
  const notebook = await readNotebookSnapshot(page);
  const rendered = await collectRenderedOutputs(page);
  const assistantAfterAccept = await collectAssistantPanelState(page).catch(() => ({
    summary: '',
    warnings: [],
    validation: [],
    previewVisible: false,
    acceptAllDisabled: true,
    enabledStepAcceptCount: 0
  }));
  await expectNoGlobalErrors(page, guards);
  return {
    provider: detectProvider(model),
    assistant,
    assistantAfterAccept,
    partialAccept,
    initialNotebook,
    initialVisibleSignature,
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
        'Create a compact SugarPy teaching notebook about solving x^2 = 2.',
        'Use only Markdown and Math cells.',
        'Show the equation, solve it with solve(...), verify both roots explicitly, include decimal approximations, and end with a short summary.'
      ].join(' ');
      const result = await runScenario({
        page,
        model,
        prompt,
        timeoutMs: 8 * 60_000,
        checkRejectFirst: true
      });
      await writeArtifact('create-ten-cell-notebook', model, result);

      const sources = result.notebook.cells.map((cell) => cell.source).join('\n');
      expect(result.assistant.previewVisible).toBe(true);
      expect(result.assistant.validation.length).toBeGreaterThan(0);
      expect(result.assistant.acceptAllDisabled).toBe(false);
      expect(result.notebook.cells).not.toEqual(result.initialNotebook.cells);
      expect(result.rendered.totalCellCount).toBeGreaterThanOrEqual(4);
      expect(result.rendered.cellErrors).toEqual([]);
      expect(sources).toContain('solve(');
      expect(result.assistant.validation.some((text) => text.includes('validated') || text.includes('schema/content pass'))).toBe(true);
      expect(result.rendered.mathOutputs.length).toBeGreaterThanOrEqual(2);
      expect(result.rendered.bodyText).toContain('sqrt');
      expect(result.rendered.bodyText).toContain('1.414');
    });

    test('extends an existing notebook without breaking earlier cells', async ({ page }) => {
      test.setTimeout(10 * 60_000);
      const prompt = [
        'Extend the current notebook into a clearer teaching notebook.',
        'Keep the existing introduction and the existing solve flow.',
        'Use only Markdown and Math cells.',
        'Add a verification section for both roots, add decimal approximations, and finish with a short summary for students.'
      ].join(' ');
      const result = await runScenario({
        page,
        model,
        prompt,
        timeoutMs: 8 * 60_000,
        fixture: assistantNotebookFixtures.extend_existing,
        checkRejectFirst: true,
        checkPartialAccept: true
      });
      await writeArtifact('extend-existing-notebook', model, result);

      const sources = result.notebook.cells.map((cell) => cell.source).join('\n');
      expect(result.assistant.previewVisible).toBe(true);
      expect(result.assistant.validation.length).toBeGreaterThan(0);
      expect(result.notebook.cells).not.toEqual(result.initialNotebook.cells);
      expect(result.rendered.cellErrors).toEqual([]);
      expect(sources).toContain('solve(');
      expect(result.rendered.bodyText).toContain('1.414');
      expect(result.assistant.validation.some((text) => text.includes('validated') || text.includes('schema/content pass'))).toBe(true);
      expect(result.rendered.mathOutputs.length).toBeGreaterThanOrEqual(2);
      if (result.partialAccept.attempted) {
        expect(result.partialAccept.remainingPreviewVisible).toBe(true);
        expect(result.partialAccept.statusText).toContain('remaining staged draft stays in chat');
      }
    });

    test('rewrites an existing notebook and deletes obsolete parts', async ({ page }) => {
      test.setTimeout(10 * 60_000);
      const prompt = [
        'Rewrite the current notebook into a compact markdown-plus-math explanation.',
        'Delete the Python helper code cell.',
        'Delete every section marked REMOVE ME.',
        'Keep the result CAS-first and student-friendly.'
      ].join(' ');
      const result = await runScenario({
        page,
        model,
        prompt,
        timeoutMs: 8 * 60_000,
        fixture: assistantNotebookFixtures.cleanup_delete,
        checkRejectFirst: true,
        checkPartialAccept: true
      });
      await writeArtifact('cleanup-and-delete', model, result);

      const sources = result.notebook.cells.map((cell) => cell.source).join('\n');
      expect(result.assistant.previewVisible).toBe(true);
      expect(result.assistant.validation.length).toBeGreaterThan(0);
      expect(result.notebook.cells).not.toEqual(result.initialNotebook.cells);
      expect(result.rendered.cellErrors).toEqual([]);
      expect(sources).not.toContain('REMOVE ME');
      expect(sources).not.toContain('from sympy import');
      expect(sources).toContain('solve(');
      expect(result.rendered.codeCellCount).toBe(0);
      if (result.partialAccept.attempted) {
        expect(result.partialAccept.remainingPreviewVisible).toBe(true);
      }
    });
  });
}
