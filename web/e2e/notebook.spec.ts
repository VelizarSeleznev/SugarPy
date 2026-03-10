import { expect, test } from '@playwright/test';

const assistantNotebookFixtures = {
  cas_two_cells: {
    version: 1,
    id: 'nb-assistant-cas',
    name: 'Assistant CAS Fixture',
    trigMode: 'rad',
    defaultMathRenderMode: 'exact',
    updatedAt: '2026-03-09T00:00:00.000Z',
    cells: [
      {
        id: 'cell-math-1',
        type: 'math',
        source: 'circle := x^2 + y^2 = 25',
        mathRenderMode: 'exact',
        mathTrigMode: 'rad'
      },
      {
        id: 'cell-code-1',
        type: 'code',
        source: 'value = 2 + 2'
      }
    ]
  },
  deg_math: {
    version: 1,
    id: 'nb-assistant-deg',
    name: 'Assistant Degree Fixture',
    trigMode: 'deg',
    defaultMathRenderMode: 'exact',
    updatedAt: '2026-03-09T00:00:00.000Z',
    cells: [
      {
        id: 'cell-math-deg',
        type: 'math',
        source: 'plot(sin(x))',
        mathRenderMode: 'exact',
        mathTrigMode: 'deg'
      }
    ]
  },
  error_notebook: {
    version: 1,
    id: 'nb-assistant-error',
    name: 'Assistant Error Fixture',
    trigMode: 'rad',
    defaultMathRenderMode: 'exact',
    updatedAt: '2026-03-09T00:00:00.000Z',
    cells: [
      {
        id: 'cell-code-error',
        type: 'code',
        source: '1/0',
        output: {
          type: 'error',
          ename: 'ZeroDivisionError',
          evalue: 'division by zero'
        }
      }
    ]
  }
} as const;

const seedNotebookFixture = async (page: any, notebook: (typeof assistantNotebookFixtures)[keyof typeof assistantNotebookFixtures]) => {
  await page.addInitScript((payload) => {
    localStorage.setItem(`sugarpy:notebook:v1:${payload.id}`, JSON.stringify(payload));
    localStorage.setItem('sugarpy:last-open', payload.id);
  }, notebook);
};

const addCodeCellToEmptyNotebook = async (page: any) => {
  const emptyState = page.locator('.cell-empty');
  if (await emptyState.isVisible()) {
    await emptyState.getByRole('button', { name: 'Code' }).click();
  }
};

const setCodeInFirstCell = async (page: any, code: string) => {
  await addCodeCellToEmptyNotebook(page);
  const firstCell = page.locator('[data-testid="cell-row-code"]').first();
  await expect(firstCell).toBeVisible();

  const editor = firstCell.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(code);

  await firstCell.locator('[data-testid="run-cell"]').click();
};

const addMathCellAfterFirstCode = async (page: any) => {
  await addCodeCellToEmptyNotebook(page);
  const divider = page.getByTestId('cell-divider-1');
  await divider.hover();
  await divider.getByRole('button', { name: 'Math' }).click();
  await expect(page.locator('[data-testid="cell-row-math"]').last()).toBeVisible();
};

const setMathInLastCell = async (page: any, source: string) => {
  const mathCell = page.locator('[data-testid="cell-row-math"]').last();
  const editor = mathCell.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(source);
  await page.keyboard.press('Shift+Enter');
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
  message.includes('Failed to load resource: net::ERR_FAILED');

const readLastPlotLayout = async (page: any) =>
  page.locator('[data-testid="plotly-graph"] .js-plotly-plot').last().evaluate((gd: any) => ({
    xRange: gd._fullLayout.xaxis.range,
    yRange: gd._fullLayout.yaxis.range,
    yScaleAnchor: gd._fullLayout.yaxis.scaleanchor ?? null,
    yScaleRatio: gd._fullLayout.yaxis.scaleratio ?? null
  }));

const expectNoGlobalErrors = async (
  page: any,
  guards: { pageErrors: string[]; consoleErrors: string[] }
) => {
  expect(guards.pageErrors).toEqual([]);
  expect(guards.consoleErrors.filter((message) => !isIgnorableConsoleError(message))).toEqual([]);
  const errors = await page.evaluate(() => (window as any).__sugarpy_errors || []);
  expect(errors).toEqual([]);
};

const expectNoPageCrashes = async (
  page: any,
  guards: { pageErrors: string[]; consoleErrors: string[] }
) => {
  expect(guards.pageErrors).toEqual([]);
  const errors = await page.evaluate(() => (window as any).__sugarpy_errors || []);
  expect(errors).toEqual([]);
};

test.describe('Notebook CAS outputs', () => {
  test('@smoke Math Test: renders SymPy formula via KaTeX', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await setCodeInFirstCell(page, 'Integral(x**2, x)');
    await expect(page.getByTestId('katex-formula')).toBeVisible();
    await expectNoGlobalErrors(page, guards);
  });

  test('@smoke Plot Test: renders Plotly graph', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await setCodeInFirstCell(page, 'plot(sin(x))');
    await expect(page.getByTestId('plotly-graph')).toBeVisible();
    await expect(page.locator('[data-testid="plotly-graph"] .js-plotly-plot')).toBeVisible();
    await expectNoGlobalErrors(page, guards);
  });

  test('Math plot: plot(sin(x)) renders Plotly graph under Math cell', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await addMathCellAfterFirstCode(page);
    await setMathInLastCell(page, 'plot(sin(x))');
    await expect(page.getByTestId('plotly-graph')).toBeVisible();
    await expect(page.locator('[data-testid="plotly-graph"] .js-plotly-plot')).toBeVisible();
    await expectNoGlobalErrors(page, guards);
  });

  test('Math multiline plot: plot(\\n ...) renders Plotly graph', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await addMathCellAfterFirstCode(page);
    await setMathInLastCell(
      page,
      `plot(
  sin(x),
  xmin=-2,
  xmax=2,
  title='demo'
)`
    );
    await expect(page.getByTestId('plotly-graph')).toBeVisible();
    await expect(page.locator('[data-testid=\"plotly-graph\"] .js-plotly-plot')).toBeVisible();
    await expectNoGlobalErrors(page, guards);
  });

  test('Math plot: xmin/xmax define the initial viewport', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await addMathCellAfterFirstCode(page);
    await setMathInLastCell(
      page,
      `plot(
  sin(x),
  xmin=-2,
  xmax=2,
  title='viewport check'
)`
    );
    await expect(page.getByTestId('plotly-graph')).toBeVisible();
    const layout = await readLastPlotLayout(page);
    expect(layout.xRange).toEqual([-2, 2]);
    await expectNoGlobalErrors(page, guards);
  });

  test('Math plot: equal_axes keeps circle geometry undistorted', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await addMathCellAfterFirstCode(page);
    await setMathInLastCell(
      page,
      `plot(
  -1 + sqrt(9 - (x - 3)^2),
  -1 - sqrt(9 - (x - 3)^2),
  1 + sqrt(4 - (x - 4)^2),
  1 - sqrt(4 - (x - 4)^2),
  xmin=0,
  xmax=8,
  equal_axes=True,
  title='circle aspect check'
)`
    );
    await expect(page.getByTestId('plotly-graph')).toBeVisible();
    const layout = await readLastPlotLayout(page);
    expect(layout.yScaleAnchor).toBe('x');
    expect(layout.yScaleRatio).toBe(1);
    expect(layout.xRange[0]).toBeLessThanOrEqual(0);
    expect(layout.xRange[1]).toBeGreaterThanOrEqual(8);
    await expectNoGlobalErrors(page, guards);
  });

  test('@smoke Error Test: renders concise runtime error without app crash', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await setCodeInFirstCell(page, '1/0');
    const errorOutput = page.getByTestId('cell-error');
    await expect(errorOutput).toBeVisible();
    await expect(errorOutput).toContainText('ZeroDivisionError: division by zero');
    await expectNoGlobalErrors(page, guards);
  });

  test('Notebook menu: Clear Outputs removes runtime outputs without resetting cells', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await setCodeInFirstCell(page, '1/0');
    await addMathCellAfterFirstCode(page);
    await setMathInLastCell(page, 'x^2 = 2');

    const errorOutput = page.getByTestId('cell-error');
    const mathOutput = page.getByTestId('math-output').last();
    await expect(errorOutput).toBeVisible();
    await expect(mathOutput).toBeVisible();

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Clear Outputs' }).click();

    await expect(page.getByTestId('cell-row-code').first().getByTestId('cell-error')).toHaveCount(0);
    const mathCell = page.locator('[data-testid="cell-row-math"]').last();
    await expect(mathCell.getByTestId('math-latex')).toHaveCount(0);
    await expect(mathCell.locator('.math-empty')).toContainText('Click to edit.');
    await expect(page.locator('[data-testid="cell-row-code"]').first().locator('.cm-content')).toContainText('1/0');
    await mathCell.getByTestId('math-output').click();
    await expect(mathCell.locator('.cm-content')).toContainText('x^2 = 2');
    await expectNoGlobalErrors(page, guards);
  });

  test('Math equation: x^2 = 2 renders in Math cell', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await addMathCellAfterFirstCode(page);
    await setMathInLastCell(page, 'x^2 = 2');
    await expect(page.getByTestId('math-output').last()).toBeVisible();
    await expect(page.getByTestId('math-latex').last()).toBeVisible();
    await expectNoGlobalErrors(page, guards);
  });

  test('Critical flow: Code function is callable from Math cell', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await setCodeInFirstCell(page, 'def f(x):\n    return x + 1');
    await addMathCellAfterFirstCode(page);
    await setMathInLastCell(page, 'f(3)');
    await expect(page.getByTestId('math-output').last()).toContainText('4');
    await expectNoGlobalErrors(page, guards);
  });

  test('Assistant flow: preview can insert and run a code cell', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    let requestCount = 0;
    await page.route('https://api.openai.com/**', async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_1',
            output: [
              {
                type: 'function_call',
                name: 'get_notebook_summary',
                arguments: JSON.stringify({ scope: 'notebook' }),
                call_id: 'tool-1'
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_2',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Inspection complete.'
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 3) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_3',
            output: [
              {
                type: 'function_call',
                name: 'set_plan_metadata',
                arguments: JSON.stringify({
                  summary: 'Add a simple code cell that computes 2 + 2.',
                  userMessage: 'Preview ready.',
                  warnings: []
                }),
                call_id: 'set-plan-1'
              },
              {
                type: 'function_call',
                name: 'add_plan_operation',
                arguments: JSON.stringify({
                  type: 'insert_cell',
                  index: 1,
                  cellType: 'code',
                  source: 'value = 2 + 2\nvalue',
                  cellId: null,
                  trigMode: null,
                  renderMode: null,
                  reason: 'Create the requested example.'
                }),
                call_id: 'add-plan-op-1'
              },
              {
                type: 'function_call',
                name: 'finalize_plan',
                arguments: '{}',
                call_id: 'finalize-plan-1'
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 4) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_4',
            output: [
              {
                type: 'function_call',
                name: 'run_code_in_sandbox',
                arguments: JSON.stringify({
                  code: 'value = 2 + 2\nvalue',
                  contextPreset: 'bootstrap-only',
                  selectedCellIds: [],
                  timeoutMs: 5000
                }),
                call_id: 'sandbox-call-1'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_5',
          output: [
            {
              type: 'function_call',
              name: 'set_plan_metadata',
              arguments: JSON.stringify({
                summary: 'Add a simple code cell that computes 2 + 2.',
                userMessage: 'Preview ready.',
                warnings: []
              }),
              call_id: 'set-plan-2'
            },
            {
              type: 'function_call',
              name: 'add_plan_operation',
              arguments: JSON.stringify({
                type: 'insert_cell',
                index: 1,
                cellType: 'code',
                source: 'value = 2 + 2\nvalue',
                cellId: null,
                trigMode: null,
                renderMode: null,
                reason: 'Create the requested example.'
              }),
              call_id: 'add-plan-op-2'
            },
            {
              type: 'function_call',
              name: 'finalize_plan',
              arguments: '{}',
              call_id: 'finalize-plan-2'
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('test-key');
    await page.getByTestId('assistant-prompt').fill('Add a code cell that computes 2 + 2 and run it.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-user-message')).toContainText(
      'Add a code cell that computes 2 + 2 and run it.'
    );
    await expect(page.getByTestId('assistant-activity')).toBeVisible();
    await expect(page.getByText('Running isolated check')).toBeVisible();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();
    await page.getByTestId('assistant-apply-run').click();
    await expect(page.locator('[data-testid="cell-row-code"]')).toHaveCount(1);
    await expect(page.getByTestId('cell-output').last()).toContainText('4');
    await expectNoGlobalErrors(page, guards);
  });

  test('Assistant sandbox: runtime error revises the drafted code before preview', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    let requestCount = 0;
    await page.route('https://api.openai.com/**', async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_sandbox_error_1',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Inspection complete.'
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_sandbox_error_2',
            output: [
              {
                type: 'function_call',
                name: 'set_plan_metadata',
                arguments: JSON.stringify({
                  summary: 'Add a code cell that computes a value.',
                  userMessage: 'Drafted an initial version.',
                  warnings: []
                }),
                call_id: 'set-plan-sandbox-err-1'
              },
              {
                type: 'function_call',
                name: 'add_plan_operation',
                arguments: JSON.stringify({
                  type: 'insert_cell',
                  index: 1,
                  cellType: 'code',
                  source: 'value = 1 / 0\nvalue',
                  cellId: null,
                  trigMode: null,
                  renderMode: null,
                  reason: 'Initial draft.'
                }),
                call_id: 'add-plan-sandbox-err-1'
              },
              {
                type: 'function_call',
                name: 'finalize_plan',
                arguments: '{}',
                call_id: 'finalize-plan-sandbox-err-1'
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 3) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_sandbox_error_3',
            output: [
              {
                type: 'function_call',
                name: 'run_code_in_sandbox',
                arguments: JSON.stringify({
                  code: 'value = 1 / 0\nvalue',
                  contextPreset: 'bootstrap-only',
                  selectedCellIds: [],
                  timeoutMs: 5000
                }),
                call_id: 'sandbox-fix-call'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_sandbox_error_4',
          output: [
            {
              type: 'function_call',
              name: 'submit_plan',
              arguments: JSON.stringify({
                summary: 'Add a working code cell that computes 2 + 2.',
                userMessage: 'Preview ready after isolated validation.',
                warnings: ['Initial draft failed sandbox validation and was revised.'],
                operations: [
                  {
                    type: 'insert_cell',
                    index: 1,
                    cellType: 'code',
                    source: 'value = 2 + 2\nvalue',
                    cellId: null,
                    trigMode: null,
                    renderMode: null,
                    reason: 'Use the validated version.'
                  }
                ]
              }),
              call_id: 'submit-plan-sandbox-err-2'
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Add a code cell that computes a safe demo value.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();
    await expect(page.locator('.assistant-warning')).toContainText('sandbox validation');
    await expect(page.locator('.assistant-op-source code')).toContainText('value = 2 + 2');
    await page.getByTestId('assistant-apply-run').click();
    await expect(page.getByTestId('cell-output').last()).toContainText('4');
    await expectNoGlobalErrors(page, guards);
  });

  test('Assistant sandbox: isolated execution does not leak variables into the live notebook kernel', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    let requestCount = 0;
    await page.route('https://api.openai.com/**', async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_sandbox_isolation_1',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Inspection complete.'
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_sandbox_isolation_2',
            output: [
              {
                type: 'function_call',
                name: 'set_plan_metadata',
                arguments: JSON.stringify({
                  summary: 'Add a code cell that stores an internal helper variable.',
                  userMessage: 'Preview ready.',
                  warnings: []
                }),
                call_id: 'set-plan-isolation-1'
              },
              {
                type: 'function_call',
                name: 'add_plan_operation',
                arguments: JSON.stringify({
                  type: 'insert_cell',
                  index: 1,
                  cellType: 'code',
                  source: 'assistant_temp = 99\nassistant_temp',
                  cellId: null,
                  trigMode: null,
                  renderMode: null,
                  reason: 'Draft a helper value.'
                }),
                call_id: 'add-plan-isolation-1'
              },
              {
                type: 'function_call',
                name: 'finalize_plan',
                arguments: '{}',
                call_id: 'finalize-plan-isolation-1'
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 3) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_sandbox_isolation_3',
            output: [
              {
                type: 'function_call',
                name: 'run_code_in_sandbox',
                arguments: JSON.stringify({
                  code: 'assistant_temp = 99\nassistant_temp',
                  contextPreset: 'bootstrap-only',
                  selectedCellIds: [],
                  timeoutMs: 5000
                }),
                call_id: 'sandbox-isolation-call'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_sandbox_isolation_4',
          output: [
            {
              type: 'function_call',
              name: 'submit_plan',
              arguments: JSON.stringify({
                summary: 'Add a code cell that stores an internal helper variable.',
                userMessage: 'Preview ready.',
                warnings: [],
                operations: [
                  {
                    type: 'insert_cell',
                    index: 1,
                    cellType: 'code',
                    source: 'assistant_temp = 99\nassistant_temp',
                    cellId: null,
                    trigMode: null,
                    renderMode: null,
                    reason: 'Validated in isolation.'
                  }
                ]
              }),
              call_id: 'submit-plan-isolation-2'
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Draft a helper cell but do not apply it.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    await setCodeInFirstCell(page, 'assistant_temp');
    await expect(page.getByTestId('cell-error').first()).toContainText("NameError");
    await expectNoGlobalErrors(page, guards);
  });

  test('Assistant sandbox: wrapped validation plan is unwrapped into preview operations', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    let requestCount = 0;
    await page.route('https://api.openai.com/**', async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_wrapped_plan_1',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Inspection complete.'
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_wrapped_plan_2',
            output: [
              {
                type: 'function_call',
                name: 'set_plan_metadata',
                arguments: JSON.stringify({
                  summary: 'Add a code cell that computes 2 + 2.',
                  userMessage: 'Preview ready.',
                  warnings: []
                }),
                call_id: 'set-plan-wrapped-1'
              },
              {
                type: 'function_call',
                name: 'add_plan_operation',
                arguments: JSON.stringify({
                  type: 'insert_cell',
                  index: 1,
                  cellType: 'code',
                  source: '2 + 2',
                  cellId: null,
                  trigMode: null,
                  renderMode: null,
                  reason: 'Add the requested computation.'
                }),
                call_id: 'add-plan-wrapped-1'
              },
              {
                type: 'function_call',
                name: 'finalize_plan',
                arguments: '{}',
                call_id: 'finalize-plan-wrapped-1'
              }
            ]
          })
        });
        return;
      }
      if (requestCount === 3) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_wrapped_plan_3',
            output: [
              {
                type: 'function_call',
                name: 'run_code_in_sandbox',
                arguments: JSON.stringify({
                  code: '2 + 2',
                  contextPreset: 'bootstrap-only',
                  selectedCellIds: [],
                  timeoutMs: 5000
                }),
                call_id: 'sandbox-wrapped-plan-call'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_wrapped_plan_4',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    plan: {
                      summary: 'Add a code cell that computes 2 + 2.',
                      userMessage: 'Preview ready after validation.',
                      warnings: [],
                      operations: [
                        {
                          type: 'insert_cell',
                          index: 1,
                          cellType: 'code',
                          source: '2 + 2',
                          reason: 'Add the requested computation.'
                        }
                      ]
                    }
                  })
                }
              ]
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Add a code cell that computes 2 + 2 and run it.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();
    await expect(page.locator('.assistant-op-title')).toContainText('Insert code cell at 2');
    await expect(page.locator('.assistant-op-source code')).toContainText('2 + 2');
    await expectNoGlobalErrors(page, guards);
  });

  test('Assistant OpenAI payload: sends valid Responses API tool schema', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_contract',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    summary: 'No changes.',
                    userMessage: 'Checked.',
                    warnings: [],
                    operations: []
                  })
                }
              ]
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Inspect the notebook and propose nothing.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    expect(seenBodies.length).toBeGreaterThan(0);
    const inspectionBody = seenBodies[0];
    expect(inspectionBody.model).toBeTruthy();
    expect(inspectionBody.tools[0].type).toBe('function');
    expect(inspectionBody.tools[0].name).toBe('get_notebook_summary');
    expect(inspectionBody.tools[0].parameters.type).toBe('object');
    expect(inspectionBody.tools[0].parameters.required).toEqual(['scope']);
    expect(inspectionBody.tools[0].parameters.additionalProperties).toBe(false);

    await expectNoGlobalErrors(page, guards);
  });

  test('Assistant OpenAI streaming: parses SSE responses into a preview', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    let requestCount = 0;
    await page.route('https://api.openai.com/**', async (route) => {
      requestCount += 1;
      const body = route.request().postDataJSON();
      expect(body.stream).toBe(true);
      if (requestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body:
            'event: response.created\n' +
            'data: {"type":"response.created","response":{"id":"resp_stream_inspect"}}\n\n' +
            'event: response.output_text.delta\n' +
            'data: {"type":"response.output_text.delta","delta":"Inspection complete."}\n\n' +
            'event: response.completed\n' +
            'data: {"type":"response.completed","response":{"id":"resp_stream_inspect","output":[{"type":"message","content":[{"type":"output_text","text":"Inspection complete."}]}]}}\n\n'
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'event: response.created\n' +
          'data: {"type":"response.created","response":{"id":"resp_stream_plan"}}\n\n' +
          'event: response.output_text.delta\n' +
          'data: {"type":"response.output_text.delta","delta":"{\\"summary\\":\\"No changes.\\",\\"userMessage\\":\\"Checked.\\",\\"warnings\\":[],\\"operations\\":[]}"}\n\n' +
          'event: response.completed\n' +
          'data: {"type":"response.completed","response":{"id":"resp_stream_plan","output":[{"type":"message","content":[{"type":"output_text","text":"{\\"summary\\":\\"No changes.\\",\\"userMessage\\":\\"Checked.\\",\\"warnings\\":[],\\"operations\\":[]}"}]}]}}\n\n'
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Inspect this notebook and propose nothing.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();
    await expectNoGlobalErrors(page, guards);
  });

  test('Assistant OpenAI streaming: active SSE chunks keep the request alive', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);

    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      const originalSetTimeout = window.setTimeout.bind(window);
      const originalClearTimeout = window.clearTimeout.bind(window);
      const encoder = new TextEncoder();
      let openAiRequestCount = 0;

      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
        const numericTimeout = typeof timeout === 'number' ? timeout : Number(timeout ?? 0);
        const clampedTimeout = numericTimeout >= 45000 ? 80 : numericTimeout;
        return originalSetTimeout(handler, clampedTimeout, ...args);
      }) as typeof window.setTimeout;
      window.clearTimeout = ((id?: number) => originalClearTimeout(id)) as typeof window.clearTimeout;

      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url !== 'https://api.openai.com/v1/responses') {
          return originalFetch(input, init);
        }
        openAiRequestCount += 1;

        const chunks =
          openAiRequestCount === 1
            ? [
                {
                  delay: 0,
                  text:
                    'event: response.created\n' +
                    'data: {"type":"response.created","response":{"id":"resp_active_inspect"}}\n\n'
                },
                {
                  delay: 20,
                  text:
                    'event: response.output_text.delta\n' +
                    'data: {"type":"response.output_text.delta","delta":"Inspection complete."}\n\n'
                },
                {
                  delay: 40,
                  text:
                    'event: response.completed\n' +
                    'data: {"type":"response.completed","response":{"id":"resp_active_inspect","output":[{"type":"message","content":[{"type":"output_text","text":"Inspection complete."}]}]}}\n\n'
                }
              ]
            : [
                {
                  delay: 0,
                  text:
                    'event: response.created\n' +
                    'data: {"type":"response.created","response":{"id":"resp_active_plan"}}\n\n'
                },
                {
                  delay: 30,
                  text:
                    'event: response.output_text.delta\n' +
                    'data: {"type":"response.output_text.delta","delta":"{\\"summary\\":\\"No "}\n\n'
                },
                {
                  delay: 60,
                  text:
                    'event: response.output_text.delta\n' +
                    'data: {"type":"response.output_text.delta","delta":"changes.\\",\\"userMessage\\":\\""}\n\n'
                },
                {
                  delay: 90,
                  text:
                    'event: response.output_text.delta\n' +
                    'data: {"type":"response.output_text.delta","delta":"Checked.\\",\\"warnings\\":[],\\"operations\\":[]}"}\n\n'
                },
                {
                  delay: 120,
                  text:
                    'event: response.completed\n' +
                    'data: {"type":"response.completed","response":{"id":"resp_active_plan","output":[{"type":"message","content":[{"type":"output_text","text":"{\\"summary\\":\\"No changes.\\",\\"userMessage\\":\\"Checked.\\",\\"warnings\\":[],\\"operations\\":[]}"}]}]}}\n\n'
                }
              ];

        const stream = new ReadableStream({
          start(controller) {
            const timers = chunks.map(({ delay, text }, index) =>
              originalSetTimeout(() => {
                if (init?.signal?.aborted) {
                  return;
                }
                controller.enqueue(encoder.encode(text));
                if (index === chunks.length - 1) {
                  controller.close();
                }
              }, delay)
            );
            init?.signal?.addEventListener(
              'abort',
              () => {
                timers.forEach((timerId) => originalClearTimeout(timerId));
                controller.error(new DOMException('The operation was aborted.', 'AbortError'));
              },
              { once: true }
            );
          }
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream'
          }
        });
      }) as typeof window.fetch;
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Inspect this notebook and propose nothing.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();
    await expect(page.locator('.assistant-summary')).toContainText('No changes.');
    await expectNoGlobalErrors(page, guards);
  });

  test('Assistant fixture: planning sees the whole seeded notebook manifest', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await seedNotebookFixture(page, assistantNotebookFixtures.cas_two_cells);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_fixture_manifest_1',
            output: [
              {
                type: 'function_call',
                name: 'get_notebook_summary',
                arguments: JSON.stringify({ scope: 'notebook' }),
                call_id: 'call-fixture-1'
              }
            ]
          })
        });
        return;
      }
      if (seenBodies.length === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_fixture_manifest_2',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Notebook inspection complete.'
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_fixture_manifest_3',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    summary: 'No changes.',
                    userMessage: 'Checked.',
                    warnings: [],
                    operations: []
                  })
                }
              ]
            }
          ]
        })
      });
    });

    await page.goto('/');
    await expect(page.locator('.file-name-input')).toHaveValue('Assistant CAS Fixture');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Inspect this notebook and propose nothing.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    const planningBody = seenBodies[2];
    const planningInput = JSON.parse(planningBody.input);
    expect(planningInput.notebookName).toBe('Assistant CAS Fixture');
    expect(planningInput.notebookManifest).toHaveLength(2);
    expect(planningInput.notebookManifest[0].type).toBe('math');
    expect(planningInput.notebookManifest[1].type).toBe('code');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant fixture: degree-mode notebook sends deg defaults to planning', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await seedNotebookFixture(page, assistantNotebookFixtures.deg_math);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: `resp_deg_${seenBodies.length}`,
          output:
            seenBodies.length < 2
              ? [
                  {
                    type: 'message',
                    content: [
                      {
                        type: 'output_text',
                        text: 'Inspection complete.'
                      }
                    ]
                  }
                ]
              : [
                  {
                    type: 'message',
                    content: [
                      {
                        type: 'output_text',
                        text: JSON.stringify({
                          summary: 'No changes.',
                          userMessage: 'Checked.',
                          warnings: [],
                          operations: []
                        })
                      }
                    ]
                  }
                ]
        })
      });
    });

    await page.goto('/');
    await expect(page.locator('.file-name-input')).toHaveValue('Assistant Degree Fixture');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Plot a circle safely for this notebook.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    const planningBody = seenBodies[1];
    const planningInput = JSON.parse(planningBody.input);
    expect(planningInput.defaults.trigMode).toBe('deg');
    expect(planningInput.notebookManifest[0].preview).toContain('plot(sin(x))');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant geometry payload: planning prompt prefers direct CAS solve workflow', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: `resp_geometry_${seenBodies.length}`,
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    summary: 'No changes.',
                    userMessage: 'Checked.',
                    warnings: [],
                    operations: []
                  })
                }
              ]
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill(
      'Find the two circle equations from A(3,38), B(26,25), radius 25. Use solve in Math cells.'
    );
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    expect(seenBodies.length).toBeGreaterThanOrEqual(1);
    const planningBody = seenBodies[0];
    expect(planningBody.instructions).toContain('If the request is mathematical, solve it in SugarPy Math cells by default.');
    expect(planningBody.instructions).toContain('Do not switch a math request into Python/Code cells just because code could also solve it.');
    expect(planningBody.instructions).toContain('Treat Code cells as last resort only for mathematical work.');
    expect(planningBody.instructions).toContain('Before choosing Code cells for a math task, assume the documented Math-cell workflow is the preferred path');
    expect(planningBody.instructions).toContain('For circle-from-points/radius tasks, prefer a minimal Math-cell workflow');
    expect(planningBody.instructions).toContain('When solve(...) is the natural SugarPy/CAS tool for the request, use it directly');
    expect(planningBody.instructions).toContain('This request looks like a direct geometry solve with concrete inputs.');
    expect(planningBody.instructions).toContain('This request looks mathematical.');
    expect(planningBody.instructions).toContain('Do not generate Python scaffolding for a math exercise unless the user explicitly requested Python.');
    expect(planningBody.instructions).toContain('Avoid over-engineered intermediate abstractions');
    if (seenBodies.length > 1) {
      expect(seenBodies[1].instructions).toContain('The previous draft avoided solve(...) even though this direct geometry task should use it.');
    }
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant math requests: code-cell draft is replanned into Math cells', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_math_replan_1',
            output: [
              {
                type: 'function_call',
                name: 'set_plan_metadata',
                arguments: JSON.stringify({
                  summary: 'Add Python code that solves the circle problem.',
                  userMessage: 'Preview ready.',
                  warnings: []
                }),
                call_id: 'set-plan-bad'
              },
              {
                type: 'function_call',
                name: 'add_plan_operation',
                arguments: JSON.stringify({
                  type: 'insert_cell',
                  index: 0,
                  cellType: 'code',
                  source: 'from sympy import symbols, Eq, solve\n# bad fallback',
                  reason: 'Initial draft used Python.'
                }),
                call_id: 'add-plan-bad'
              },
              {
                type: 'function_call',
                name: 'finalize_plan',
                arguments: '{}',
                call_id: 'finalize-plan-bad'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_math_replan_2',
          output: [
            {
              type: 'function_call',
              name: 'set_plan_metadata',
              arguments: JSON.stringify({
                summary: 'Add Math cells that solve the circle equations through the given points.',
                userMessage: 'Preview ready.',
                warnings: []
              }),
              call_id: 'set-plan-good'
            },
            {
              type: 'function_call',
              name: 'add_plan_operation',
              arguments: JSON.stringify({
                type: 'insert_cell',
                index: 0,
                cellType: 'math',
                source:
                  'eqA := (x0-3)^2 + (y0-38)^2 = 25^2\n' +
                  'eqB := (x0-26)^2 + (y0-25)^2 = 25^2\n' +
                  'sol := solve({eqA, eqB}, (x0, y0))',
                reason: 'Use CAS directly for the math task.'
              }),
              call_id: 'add-plan-good'
            },
            {
              type: 'function_call',
              name: 'finalize_plan',
              arguments: '{}',
              call_id: 'finalize-plan-good'
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page
      .getByTestId('assistant-prompt')
      .fill('Find the two circle equations from A(3,38), B(26,25), radius 25.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    await expect(page.locator('.assistant-op-title')).toContainText('Insert math cell at 1');
    await expect(page.locator('.assistant-op-source code')).toContainText('solve({eqA, eqB}, (x0, y0))');
    await expect(page.locator('.assistant-op-source code')).not.toContainText('from sympy import');

    expect(seenBodies).toHaveLength(2);
    expect(seenBodies[1].instructions).toContain('The previous draft incorrectly used Code cells for a mathematical request.');
    expect(seenBodies[1].instructions).toContain('Regenerate the plan using Math cells only.');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant empty math request: skips remote inspection loop and treats "write me a code" as non-Python math intent', async ({
    page
  }) => {
    const guards = attachBrowserErrorGuards(page);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_empty_math_1',
            output: [
              {
                type: 'function_call',
                name: 'set_plan_metadata',
                arguments: JSON.stringify({
                  summary: 'Bad initial code-first answer.',
                  userMessage: 'Preview ready.',
                  warnings: []
                }),
                call_id: 'set-plan-empty-bad'
              },
              {
                type: 'function_call',
                name: 'add_plan_operation',
                arguments: JSON.stringify({
                  type: 'insert_cell',
                  index: 0,
                  cellType: 'code',
                  source: 'from sympy import symbols, Eq, solve',
                  reason: 'Incorrect Python-first draft.'
                }),
                call_id: 'add-plan-empty-bad'
              },
              {
                type: 'function_call',
                name: 'finalize_plan',
                arguments: '{}',
                call_id: 'finalize-plan-empty-bad'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_empty_math_2',
          output: [
            {
              type: 'function_call',
              name: 'set_plan_metadata',
              arguments: JSON.stringify({
                summary: 'Use Math cells to solve the two circle equations.',
                userMessage: 'Preview ready.',
                warnings: []
              }),
              call_id: 'set-plan-empty-good'
            },
            {
              type: 'function_call',
              name: 'add_plan_operation',
              arguments: JSON.stringify({
                type: 'insert_cell',
                index: 0,
                cellType: 'math',
                source:
                  'eqA := (x0-3)^2 + (y0-38)^2 = 25^2\n' +
                  'eqB := (x0-26)^2 + (y0-25)^2 = 25^2\n' +
                  'sol := solve({eqA, eqB}, (x0, y0))',
                reason: 'Use CAS directly.'
              }),
              call_id: 'add-plan-empty-good'
            },
            {
              type: 'function_call',
              name: 'finalize_plan',
              arguments: '{}',
              call_id: 'finalize-plan-empty-good'
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page
      .getByTestId('assistant-prompt')
      .fill('write me a code that will find a circle equation from two points and afterwards plot it. Point A(3,38) B(26,25), radius = 25');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    expect(seenBodies).toHaveLength(2);
    expect(seenBodies[0].instructions).toContain('If the request is mathematical, solve it in SugarPy Math cells by default.');
    expect(seenBodies[1].instructions).toContain('Regenerate the plan using Math cells only.');
    await expect(page.locator('.assistant-op-title')).toContainText('Insert math cell at 1');
    await expect(page.locator('.assistant-op-source code')).toContainText('solve({eqA, eqB}, (x0, y0))');
    await expect(page.locator('.assistant-op-source code')).not.toContainText('from sympy import');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant direct geometry requests: replan until Math cells use solve(...) explicitly', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_direct_geom_1',
            output: [
              {
                type: 'function_call',
                name: 'set_plan_metadata',
                arguments: JSON.stringify({
                  summary: 'Use manual geometry.',
                  userMessage: 'Preview ready.',
                  warnings: []
                }),
                call_id: 'set-plan-geom-bad'
              },
              {
                type: 'function_call',
                name: 'add_plan_operation',
                arguments: JSON.stringify({
                  type: 'insert_cell',
                  index: 0,
                  cellType: 'math',
                  source: 'mid_x := (3 + 26)/2\nmid_y := (38 + 25)/2\ncenter1_x := mid_x + 1\ncenter1_y := mid_y + 1',
                  reason: 'Bad draft skipped solve.'
                }),
                call_id: 'add-plan-geom-bad'
              },
              {
                type: 'function_call',
                name: 'finalize_plan',
                arguments: '{}',
                call_id: 'finalize-plan-geom-bad'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_direct_geom_2',
          output: [
            {
              type: 'function_call',
              name: 'set_plan_metadata',
              arguments: JSON.stringify({
                summary: 'Use solve in Math cells.',
                userMessage: 'Preview ready.',
                warnings: []
              }),
              call_id: 'set-plan-geom-good'
            },
            {
              type: 'function_call',
              name: 'add_plan_operation',
              arguments: JSON.stringify({
                type: 'insert_cell',
                index: 0,
                cellType: 'math',
                source:
                  'eqA := (x0-3)^2 + (y0-38)^2 = 25^2\n' +
                  'eqB := (x0-26)^2 + (y0-25)^2 = 25^2\n' +
                  'sol := solve({eqA, eqB}, (x0, y0))',
                reason: 'Direct CAS solve.'
              }),
              call_id: 'add-plan-geom-good'
            },
            {
              type: 'function_call',
              name: 'finalize_plan',
              arguments: '{}',
              call_id: 'finalize-plan-geom-good'
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page
      .getByTestId('assistant-prompt')
      .fill('Find the two circle equations from A(3,38), B(26,25), radius 25.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    expect(seenBodies).toHaveLength(1);
    await expect(page.locator('.assistant-op-source code').first()).toContainText('solutions := solve((eqA, eqB), (h, k))');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant planning: retries when model returns prose instead of plan JSON', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_prose_retry_1',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'I created a Math-cell solution for the circle problem.'
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_prose_retry_2',
          output: [
            {
              type: 'function_call',
              name: 'set_plan_metadata',
              arguments: JSON.stringify({
                summary: 'Use Math cells.',
                userMessage: 'Preview ready.',
                warnings: []
              }),
              call_id: 'set-plan-prose-good'
            },
            {
              type: 'function_call',
              name: 'add_plan_operation',
              arguments: JSON.stringify({
                type: 'insert_cell',
                index: 0,
                cellType: 'math',
                source: 'eqA := (x0-3)^2 + (y0-38)^2 = 25^2\nsol := solve(eqA, x0)',
                reason: 'Structured retry.'
              }),
              call_id: 'add-plan-prose-good'
            },
            {
              type: 'function_call',
              name: 'finalize_plan',
              arguments: '{}',
              call_id: 'finalize-plan-prose-good'
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page
      .getByTestId('assistant-prompt')
      .fill('Find the two circle equations from A(3,38), B(26,25), radius 25.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    expect(seenBodies).toHaveLength(2);
    expect(String(seenBodies[1].input)).toContain('Your previous planning response was not valid AssistantPlan JSON');
    await expect(page.locator('.assistant-op-title')).toContainText('Insert math cell at 1');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant planning: accepts submit_plan in a single response', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_submit_plan_1',
          output: [
            {
              type: 'function_call',
              name: 'submit_plan',
              arguments: JSON.stringify({
                summary: 'Use one Math cell.',
                userMessage: 'Preview ready.',
                warnings: [],
                operations: [
                  {
                    type: 'insert_cell',
                    index: 0,
                    cellType: 'math',
                    source: 'eqA := (x0-3)^2 + (y0-38)^2 = 25^2',
                    cellId: null,
                    trigMode: null,
                    renderMode: null,
                    reason: 'Single-call plan.'
                  }
                ]
              }),
              call_id: 'submit-plan-single'
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Find the circle equations.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    expect(seenBodies).toHaveLength(1);
    expect(seenBodies[0].tools.some((tool: any) => tool.name === 'submit_plan')).toBe(true);
    await expect(page.locator('.assistant-op-title')).toContainText('Insert math cell at 1');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant fixture: recent error details are fed back through tool outputs', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await seedNotebookFixture(page, assistantNotebookFixtures.error_notebook);
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_error_1',
            output: [
              {
                type: 'function_call',
                name: 'get_recent_errors',
                arguments: '{}',
                call_id: 'call-error-1'
              }
            ]
          })
        });
        return;
      }
      if (seenBodies.length === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_error_2',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Inspected recent errors.'
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_error_3',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    summary: 'No changes.',
                    userMessage: 'Checked.',
                    warnings: [],
                    operations: []
                  })
                }
              ]
            }
          ]
        })
      });
    });

    await page.goto('/');
    await expect(page.locator('.file-name-input')).toHaveValue('Assistant Error Fixture');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Check the recent error and suggest a fix.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    const secondBody = seenBodies[1];
    expect(Array.isArray(secondBody.input)).toBe(true);
    expect(secondBody.input[0].type).toBe('function_call_output');
    expect(secondBody.input[0].output).toContain('ZeroDivisionError');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant sandbox: imports-only replays notebook imports for isolated validation', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await seedNotebookFixture(page, {
      version: 1,
      id: 'nb-assistant-imports',
      name: 'Assistant Imports Fixture',
      trigMode: 'rad',
      defaultMathRenderMode: 'exact',
      updatedAt: '2026-03-09T00:00:00.000Z',
      cells: [
        {
          id: 'cell-imports',
          type: 'code',
          source: 'import statistics'
        }
      ]
    });
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_imports_1',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'Inspection complete.' }]
              }
            ]
          })
        });
        return;
      }
      if (seenBodies.length === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_imports_2',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      summary: 'Add a code cell that computes a mean.',
                      userMessage: 'Preview ready.',
                      warnings: [],
                      operations: [
                        {
                          type: 'insert_cell',
                          index: 1,
                          cellType: 'code',
                          source: 'statistics.mean([2, 4, 6])',
                          reason: 'Use the imported statistics module.'
                        }
                      ]
                    })
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      if (seenBodies.length === 3) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_imports_3',
            output: [
              {
                type: 'function_call',
                name: 'run_code_in_sandbox',
                arguments: JSON.stringify({
                  code: 'statistics.mean([2, 4, 6])',
                  contextPreset: 'imports-only',
                  selectedCellIds: [],
                  timeoutMs: 5000
                }),
                call_id: 'sandbox-imports-call'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_imports_4',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    summary: 'Add a code cell that computes a mean.',
                    userMessage: 'Preview ready.',
                    warnings: [],
                    operations: [
                      {
                        type: 'insert_cell',
                        index: 1,
                        cellType: 'code',
                        source: 'statistics.mean([2, 4, 6])',
                        reason: 'Validated with imports-only.'
                      }
                    ]
                  })
                }
              ]
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Add a statistics example.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    expect(seenBodies[2].tools[0].name).toBe('run_code_in_sandbox');
    const validationOutput = seenBodies[3].input[0].output;
    expect(validationOutput).toContain('"contextPresetUsed":"imports-only"');
    expect(validationOutput).toContain('"status":"ok"');
    await expectNoPageCrashes(page, guards);
  });

  test('Assistant sandbox: selected-cells replays only the requested code cells', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await seedNotebookFixture(page, {
      version: 1,
      id: 'nb-assistant-selected',
      name: 'Assistant Selected Fixture',
      trigMode: 'rad',
      defaultMathRenderMode: 'exact',
      updatedAt: '2026-03-09T00:00:00.000Z',
      cells: [
        {
          id: 'cell-helper',
          type: 'code',
          source: 'helper = 21'
        },
        {
          id: 'cell-other',
          type: 'code',
          source: 'other = 5'
        }
      ]
    });
    const seenBodies: any[] = [];
    await page.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON();
      seenBodies.push(body);
      if (seenBodies.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_selected_1',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'Inspection complete.' }]
              }
            ]
          })
        });
        return;
      }
      if (seenBodies.length === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_selected_2',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      summary: 'Add a code cell that doubles the helper value.',
                      userMessage: 'Preview ready.',
                      warnings: [],
                      operations: [
                        {
                          type: 'insert_cell',
                          index: 2,
                          cellType: 'code',
                          source: 'helper * 2',
                          reason: 'Use the helper cell.'
                        }
                      ]
                    })
                  }
                ]
              }
            ]
          })
        });
        return;
      }
      if (seenBodies.length === 3) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'resp_selected_3',
            output: [
              {
                type: 'function_call',
                name: 'run_code_in_sandbox',
                arguments: JSON.stringify({
                  code: 'helper * 2',
                  contextPreset: 'selected-cells',
                  selectedCellIds: ['cell-helper'],
                  timeoutMs: 5000
                }),
                call_id: 'sandbox-selected-call'
              }
            ]
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_selected_4',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    summary: 'Add a code cell that doubles the helper value.',
                    userMessage: 'Preview ready.',
                    warnings: [],
                    operations: [
                      {
                        type: 'insert_cell',
                        index: 2,
                        cellType: 'code',
                        source: 'helper * 2',
                        reason: 'Validated with selected-cells.'
                      }
                    ]
                  })
                }
              ]
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-settings-toggle').click();
    await page.getByTestId('assistant-api-key').fill('sk-test');
    await page.getByTestId('assistant-prompt').fill('Double the helper value in a new cell.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();

    const validationOutput = seenBodies[3].input[0].output;
    expect(validationOutput).toContain('"contextPresetUsed":"selected-cells"');
    expect(validationOutput).toContain('"replayedCellIds":["cell-helper"]');
    expect(validationOutput).toContain('"status":"ok"');
    await expectNoPageCrashes(page, guards);
  });

  test('Header overlays: outside click closes menu and assistant drawer', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');

    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.locator('.header-menu')).toBeVisible();
    await page.locator('.file-name-input').click();
    await expect(page.locator('.header-menu')).toBeHidden();

    await page.getByTestId('assistant-toggle').click();
    await expect(page.locator('.assistant-drawer.open')).toBeVisible();
    await page.locator('.file-name-input').click();
    await expect(page.locator('.assistant-drawer.open')).toHaveCount(0);

    await expectNoGlobalErrors(page, guards);
  });

  test('Local autosave quota: notebook stays usable when browser storage is full', async ({ page }) => {
    await page.addInitScript(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (String(key).startsWith('sugarpy:notebook:v1:')) {
          throw new DOMException(
            `Setting the value of '${key}' exceeded the quota.`,
            'QuotaExceededError'
          );
        }
        return originalSetItem.call(this, key, value);
      };
    });

    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await setCodeInFirstCell(page, '2 + 2');
    await expect(page.getByTestId('cell-output').first()).toContainText('4');
    await page.waitForTimeout(1200);
    await expect(page.getByText('SugarPy failed to load')).toHaveCount(0);
    await expectNoGlobalErrors(page, guards);
  });

  test('Local autosave cleanup: old notebook snapshots are pruned on load', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'sugarpy:notebook:v1:nb-current',
        JSON.stringify({
          version: 1,
          id: 'nb-current',
          name: 'Current notebook',
          trigMode: 'deg',
          defaultMathRenderMode: 'exact',
          cells: [{ id: 'cell-1', source: '2 + 2', type: 'code' }],
          updatedAt: '2026-03-09T10:00:00.000Z'
        })
      );
      window.localStorage.setItem(
        'sugarpy:notebook:v1:nb-old-1',
        JSON.stringify({
          version: 1,
          id: 'nb-old-1',
          name: 'Old notebook 1',
          trigMode: 'deg',
          defaultMathRenderMode: 'exact',
          cells: [{ id: 'cell-1', source: '1 + 1', type: 'code' }],
          updatedAt: '2026-03-08T10:00:00.000Z'
        })
      );
      window.localStorage.setItem(
        'sugarpy:notebook:v1:nb-old-2',
        JSON.stringify({
          version: 1,
          id: 'nb-old-2',
          name: 'Old notebook 2',
          trigMode: 'deg',
          defaultMathRenderMode: 'exact',
          cells: [{ id: 'cell-1', source: '3 + 3', type: 'code' }],
          updatedAt: '2026-03-07T10:00:00.000Z'
        })
      );
      window.localStorage.setItem('sugarpy:last-open', 'nb-current');
    });

    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await expect(page.locator('.file-name-input')).toHaveValue('Current notebook');
    const notebookKeys = await page.evaluate(() =>
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith('sugarpy:notebook:v1:'))
        .sort()
    );
    expect(notebookKeys).toEqual(['sugarpy:notebook:v1:nb-current']);
    expect(guards.pageErrors).toEqual([]);
    const errors = await page.evaluate(() => (window as any).__sugarpy_errors || []);
    expect(errors).toEqual([]);
  });
});
