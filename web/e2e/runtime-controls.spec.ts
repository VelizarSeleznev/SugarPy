import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sugarpy:onboarding:seen:v1', '1');
  });
});

const runtimeConfig = {
  mode: 'restricted-demo',
  execution: {
    runtimeBackend: 'docker',
    codeCellsRestricted: false,
    assistantSandboxCodeCellsRestricted: true
  }
};

const installRuntimeApiMocks = async (page: any, runtimeAction: 'interrupt' | 'restart' | 'delete') => {
  let executeResponseResolver: (() => void) | null = null;
  const releaseExecuteResponse = () => executeResponseResolver?.();

  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runtimeConfig),
    });
  });
  await page.route('**/api/autosave/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not found' }),
    });
  });
  await page.route('**/api/execute', async (route) => {
    await new Promise<void>((resolve) => {
      executeResponseResolver = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        notebookId: 'notebook',
        cellId: 'cell-1',
        cellType: 'code',
        status: 'ok',
        execCountIncrement: true,
        output: {
          type: 'mime',
          data: { 'text/plain': 'late success' },
        },
      }),
    });
  });
  await page.route(`**/api/runtime/*/${runtimeAction}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        notebookId: 'notebook',
        status: runtimeAction === 'delete' ? 'disconnected' : 'connected',
        backend: 'docker',
        containerName: 'fake',
        workspacePath: '/tmp/fake',
        connectionFilePath: '/tmp/fake/kernel.json',
        image: 'fake-image',
        interrupted: runtimeAction === 'interrupt',
      }),
    });
  });
  await page.route('**/api/runtime/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        notebookId: 'notebook',
        status: 'connected',
        backend: 'docker',
        containerName: 'fake',
        workspacePath: '/tmp/fake',
        connectionFilePath: '/tmp/fake/kernel.json',
        image: 'fake-image',
      }),
    });
  });

  return { releaseExecuteResponse };
};

const startCodeExecution = async (page: any) => {
  await page.goto('/');
  const emptyState = page.locator('.cell-empty');
  if (await emptyState.isVisible()) {
    await emptyState.getByRole('button', { name: /^Code$/ }).click();
  } else {
    await page.getByRole('button', { name: 'Add code cell' }).click();
  }
  const codeCell = page.locator('[data-testid="cell-row-code"]').first();
  await codeCell.locator('.cm-content').first().click();
  await page.keyboard.type('while True: pass');
  await codeCell.locator('[data-testid="run-cell"]').click();
  await expect(codeCell.getByRole('button', { name: 'Stop cell' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Stop Runtime' })).toBeEnabled();
  return codeCell;
};

test.describe('Notebook runtime controls', () => {
  test('First execution on a new notebook does not show a fresh-runtime notice', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(runtimeConfig),
      });
    });
    await page.route('**/api/autosave/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not found' }),
      });
    });
    await page.route('**/api/execute', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          notebookId: 'notebook',
          cellId: 'cell-1',
          cellType: 'code',
          status: 'ok',
          freshRuntime: true,
          execCountIncrement: true,
          output: {
            type: 'mime',
            data: { 'text/plain': '4' },
          },
        }),
      });
    });

    await page.goto('/');
    const emptyState = page.locator('.cell-empty');
    await emptyState.getByRole('button', { name: /^Code$/ }).click();
    const codeCell = page.locator('[data-testid="cell-row-code"]').first();
    await codeCell.locator('.cm-content').first().click();
    await page.keyboard.type('2 + 2');
    await codeCell.locator('[data-testid="run-cell"]').click();

    await expect(codeCell.getByTestId('cell-plain-output')).toContainText('4');
    await expect(page.locator('.runtime-notice')).toHaveCount(0);
  });

  test('Stop Runtime keeps stale execution results out of the UI', async ({ page }) => {
    const { releaseExecuteResponse } = await installRuntimeApiMocks(page, 'interrupt');
    const codeCell = await startCodeExecution(page);

    await page.getByRole('button', { name: 'Stop Runtime' }).click();
    await expect(codeCell.getByTestId('cell-error')).toContainText('Execution interrupted.');

    releaseExecuteResponse();
    await page.waitForTimeout(200);
    await expect(codeCell.getByTestId('cell-error')).toContainText('Execution interrupted.');
    await expect(codeCell.getByTestId('cell-plain-output')).toHaveCount(0);
  });

  test('Running cell exposes a stop control in the gutter', async ({ page }) => {
    const { releaseExecuteResponse } = await installRuntimeApiMocks(page, 'interrupt');
    const codeCell = await startCodeExecution(page);

    await codeCell.getByRole('button', { name: 'Stop cell' }).click();
    await expect(codeCell.getByTestId('cell-error')).toContainText('Execution interrupted.');

    releaseExecuteResponse();
    await page.waitForTimeout(200);
    await expect(codeCell.getByRole('button', { name: 'Run cell' })).toBeVisible();
  });

  test('Restart Notebook Runtime resets the active execution state', async ({ page }) => {
    const { releaseExecuteResponse } = await installRuntimeApiMocks(page, 'restart');
    const codeCell = await startCodeExecution(page);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Restart Notebook Runtime' }).click();
    await expect(codeCell.getByTestId('cell-error')).toContainText('Runtime restarted.');
    await expect(page.locator('.runtime-notice')).toContainText('Previous outputs belong to the old kernel');

    releaseExecuteResponse();
    await page.waitForTimeout(200);
    await expect(codeCell.getByTestId('cell-plain-output')).toHaveCount(0);
  });

  test('Delete Notebook Runtime resets the active execution state', async ({ page }) => {
    const { releaseExecuteResponse } = await installRuntimeApiMocks(page, 'delete');
    const codeCell = await startCodeExecution(page);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Delete Notebook Runtime' }).click();
    await expect(codeCell.getByTestId('cell-error')).toContainText('Runtime deleted.');

    releaseExecuteResponse();
    await page.waitForTimeout(200);
    await expect(codeCell.getByTestId('cell-plain-output')).toHaveCount(0);
  });
});
