import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const pdfPath = process.env.ASSISTANT_PHOTO_IMPORT_PDF || '/Users/velizard/Downloads/PlangeometriProveRetteark.pdf';
const baseUrl = process.env.ASSISTANT_BASE_URL || 'http://localhost:5173/';
const timeoutMs = Number(process.env.ASSISTANT_PHOTO_IMPORT_TIMEOUT_MS || 240000);
const artifactDir = path.resolve(process.cwd(), '../output/playwright');

const waitForPhotoImportToSettle = async (page, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      loading: document.querySelectorAll('.assistant-loading-line').length,
      previewVisible: !!document.querySelector('[data-testid="assistant-preview"]'),
      stepCount: document.querySelectorAll('[data-testid="assistant-step-card"]').length,
      terminalErrors: Array.from(document.querySelectorAll('.assistant-error')).map((node) => (node.textContent || '').trim())
    }));
    if (state.stepCount > 0) return state;
    if (state.previewVisible) return state;
    if (state.terminalErrors.length > 0 && state.loading === 0) return state;
    await page.waitForTimeout(5000);
  }
  throw new Error(`Photo import did not settle within ${timeout}ms`);
};

const collectArtifact = async (page) =>
  page.evaluate(() => {
    const traceKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith('sugarpy:assistant:traces:v1:')) traceKeys.push(key);
    }
    const traceEntries = traceKeys.flatMap((key) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(parsed) ? parsed.map((entry) => ({ key, entry })) : [];
      } catch {
        return [];
      }
    });
    traceEntries.sort((left, right) => String(right.entry?.startedAt || '').localeCompare(String(left.entry?.startedAt || '')));

    return {
      settledAt: new Date().toISOString(),
      summary: (document.querySelector('.assistant-summary')?.textContent || '').trim(),
      errors: Array.from(document.querySelectorAll('.assistant-error')).map((node) => (node.textContent || '').trim()),
      warnings: Array.from(document.querySelectorAll('.assistant-warning')).map((node) => (node.textContent || '').trim()),
      validation: Array.from(document.querySelectorAll('.assistant-validation-detail .assistant-op-reason')).map((node) =>
        (node.textContent || '').trim()
      ),
      steps: Array.from(document.querySelectorAll('[data-testid="assistant-step-card"]')).map((card) => ({
        title: (card.querySelector('.assistant-op-title')?.textContent || '').trim(),
        explanation: (card.querySelector('.assistant-step-header .assistant-op-reason')?.textContent || '').trim(),
        source: (card.querySelector('.assistant-op-source code')?.textContent || '').trim(),
        errors: Array.from(card.querySelectorAll('.assistant-error')).map((node) => (node.textContent || '').trim())
      })),
      traceKeys,
      latestTrace: traceEntries[0]?.entry || null
    };
  });

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByTestId('assistant-photo-entry').click();
    await page.getByTestId('assistant-photo-input').setInputFiles(pdfPath);
    await page.getByTestId('assistant-photo-preview').nth(4).waitFor({ timeout: 30000 });
    await page.getByTestId('assistant-photo-extract').click();
    await waitForPhotoImportToSettle(page, timeoutMs);
    const artifact = await collectArtifact(page);
    await fs.mkdir(artifactDir, { recursive: true });
    const outputPath = path.join(artifactDir, 'assistant-photo-import-trace.json');
    await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    console.log(outputPath);
  } finally {
    await browser.close();
  }
};

await main();
