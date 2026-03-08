import { expect, test } from '@playwright/test';

const setCodeInFirstCell = async (page: any, code: string) => {
  const firstCell = page.locator('[data-testid="cell-row-code"]').first();
  await expect(firstCell).toBeVisible();

  const editor = firstCell.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(code);

  await firstCell.locator('[data-testid="run-cell"]').click();
};

const addMathCellAfterFirstCode = async (page: any) => {
  const divider = page.getByTestId('cell-divider-1');
  await divider.hover();
  await divider.getByRole('button', { name: 'Math' }).click();
  await expect(page.locator('[data-testid="cell-row-math"]').last()).toBeVisible();
};

const setLanguageInFirstCodeCell = async (page: any, languageLabel: 'Python' | 'C' | 'Go' | 'PHP') => {
  const firstCell = page.locator('[data-testid="cell-row-code"]').first();
  await firstCell.hover();
  const selector = firstCell.getByTestId('code-language-select').first();
  await expect(selector).toBeVisible();
  await selector.selectOption({ label: languageLabel });
};

const setMathInLastCell = async (page: any, source: string) => {
  const mathCell = page.locator('[data-testid="cell-row-math"]').last();
  const editor = mathCell.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(source);
  await mathCell.locator('[data-testid="run-cell"]').click();
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

const expectNoGlobalErrors = async (
  page: any,
  guards: { pageErrors: string[]; consoleErrors: string[] }
) => {
  expect(guards.pageErrors).toEqual([]);
  expect(guards.consoleErrors).toEqual([]);
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

  test('@smoke Code language selector: non-Python run shows unsupported-language message', async ({ page }) => {
    const guards = attachBrowserErrorGuards(page);
    await page.goto('/');
    await setLanguageInFirstCodeCell(page, 'Go');
    await setCodeInFirstCell(page, 'fmt.Println("hello")');
    const errorOutput = page.getByTestId('cell-error');
    await expect(errorOutput).toBeVisible();
    await expect(errorOutput).toContainText(
      'UnsupportedLanguage: GO execution is not available yet. Switch to Python to run this cell.'
    );
    await expectNoGlobalErrors(page, guards);
  });
});
