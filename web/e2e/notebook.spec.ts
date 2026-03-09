import { expect, test } from '@playwright/test';

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

  test('Assistant flow: Gemini preview can insert and run a code cell', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    let requestCount = 0;
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'get_notebook_summary',
                        args: { scope: 'notebook' }
                      }
                    }
                  ]
                }
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
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: 'Add a simple code cell that computes 2 + 2.',
                      userMessage: 'Preview ready.',
                      warnings: [],
                      operations: [
                        {
                          type: 'insert_cell',
                          index: 1,
                          cellType: 'code',
                          source: 'value = 2 + 2\nvalue',
                          reason: 'Create the requested example.'
                        }
                      ]
                    })
                  }
                ]
              }
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.getByTestId('assistant-toggle').click();
    await page.getByTestId('assistant-api-key').fill('test-key');
    await page.getByTestId('assistant-preference').selectOption('cas');
    await page.getByTestId('assistant-prompt').fill('Add a code cell that computes 2 + 2 and run it.');
    await page.getByTestId('assistant-generate').click();
    await expect(page.getByTestId('assistant-activity')).toBeVisible();
    await expect(page.getByTestId('assistant-preview')).toBeVisible();
    await page.getByTestId('assistant-apply-run').click();
    await expect(page.locator('[data-testid="cell-row-code"]')).toHaveCount(1);
    await expect(page.getByTestId('cell-output').last()).toContainText('4');
    await expectNoGlobalErrors(page, guards);
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
