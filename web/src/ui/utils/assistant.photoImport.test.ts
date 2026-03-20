import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOpenAIPhotoImportInput, normalizeAssistantMathSource } from './assistant.ts';
import { buildAssistantImportSummary } from './assistantImportSummary.ts';

test('buildOpenAIPhotoImportInput includes all queued images in order', () => {
  const input = buildOpenAIPhotoImportInput('import pages', {
    instructions: 'keep the clean derivation',
    items: [
      {
        imageDataUrl: 'data:image/png;base64,AAAA',
        fileName: 'page-1.png',
        displayName: 'page-1.png',
        mimeType: 'image/png'
      },
      {
        imageDataUrl: 'data:image/jpeg;base64,BBBB',
        fileName: 'notes.pdf',
        displayName: 'notes.pdf · page 2',
        mimeType: 'image/jpeg',
        pageNumber: 2
      }
    ]
  });

  assert.equal(input.length, 1);
  assert.equal(input[0]?.role, 'user');
  const content = input[0]?.content ?? [];
  assert.equal(content.length, 3);
  assert.deepEqual(content[0], {
    type: 'input_text',
    text: 'import pages'
  });
  assert.deepEqual(content[1], {
    type: 'input_image',
    image_url: 'data:image/png;base64,AAAA'
  });
  assert.deepEqual(content[2], {
    type: 'input_image',
    image_url: 'data:image/jpeg;base64,BBBB'
  });
});

test('buildAssistantImportSummary groups PDF pages and keeps standalone images', () => {
  const summary = buildAssistantImportSummary([
    {
      id: 'img-1',
      kind: 'image',
      sourceKey: 'img-1',
      sourceFileName: 'photo.png',
      displayName: 'photo.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 100,
      height: 100,
      sourceSizeBytes: 4
    },
    {
      id: 'pdf-1',
      kind: 'pdf-page',
      sourceKey: 'pdf',
      sourceFileName: 'notes.pdf',
      displayName: 'notes.pdf · page 1',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,BBBB',
      width: 100,
      height: 100,
      pageNumber: 1,
      sourceSizeBytes: 4
    },
    {
      id: 'pdf-2',
      kind: 'pdf-page',
      sourceKey: 'pdf',
      sourceFileName: 'notes.pdf',
      displayName: 'notes.pdf · page 2',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,CCCC',
      width: 100,
      height: 100,
      pageNumber: 2,
      sourceSizeBytes: 4
    }
  ]);

  assert.equal(summary, 'photo.png, notes.pdf (pages 1, 2)');
});

test('normalizeAssistantMathSource splits chained top-level equalities into one equation per line', () => {
  const normalized = normalizeAssistantMathSource('y = -x + 4 = x^2 - 3*x + 2');
  assert.equal(normalized, 'y = -x + 4\n-x + 4 = x^2 - 3*x + 2');
});

test('normalizeAssistantMathSource leaves assignments and single equations unchanged', () => {
  const source = 'eq1 := (x - 2)^2 + (y - 1)^2 = 9\npoint := (3, 2)\ny = 2*x + 1';
  assert.equal(normalizeAssistantMathSource(source), source);
});
