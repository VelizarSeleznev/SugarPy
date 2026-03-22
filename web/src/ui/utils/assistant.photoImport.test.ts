import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenAIPhotoImportInput,
  collectPhotoImportStructureDiagnostics,
  collectAssistantPhotoImportSuspiciousIdentifiers,
  getAssistantPhotoImportMarkdownIssue,
  normalizeAssistantMathSource
} from './assistant.ts';
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

test('normalizeAssistantMathSource rewrites textbook norm notation into SugarPy assignments', () => {
  const normalized = normalizeAssistantMathSource(
    '|P_1P_2| = sqrt((1 - (-3/5))^2 + (4 - 4/5)^2)\n|P_1P_2| = 1/5 sqrt(320)'
  );
  assert.equal(
    normalized,
    'distance_p_1p_2 := sqrt((1 - (-3/5))^2 + (4 - 4/5)^2)\ndistance_p_1p_2 = 1/5*sqrt(320)'
  );
});

test('normalizeAssistantMathSource rewrites plus-minus solutions into explicit CAS assignments', () => {
  const normalized = normalizeAssistantMathSource('x = (-b ± sqrt(D)) / (2a)');
  assert.equal(normalized, 'x_1 := (-b - sqrt(D)) / (2*a)\nx_2 := (-b + sqrt(D)) / (2*a)');
});

test('normalizeAssistantMathSource rewrites v-separated handwritten alternatives into explicit assignments', () => {
  const normalized = normalizeAssistantMathSource('(-3 / 5) v x = 1');
  assert.equal(normalized, 'x_1 := -3 / 5\nx_2 := 1');
});

test('normalizeAssistantMathSource carries forward the lhs for handwritten follow-up equality lines', () => {
  const normalized = normalizeAssistantMathSource(
    '|P_1P_2| = sqrt((1 - (-3 / 5))^2 + (4 - 4 / 5)^2)\n= sqrt((8 / 5)^2 + (16 / 5)^2)\n= 1 / 5 * sqrt(320)'
  );
  assert.equal(
    normalized,
    'distance_p_1p_2 := sqrt((1 - (-3 / 5))^2 + (4 - 4 / 5)^2)\ndistance_p_1p_2 = sqrt((8 / 5)^2 + (16 / 5)^2)\ndistance_p_1p_2 = 1 / 5 * sqrt(320)'
  );
});

test('normalizeAssistantMathSource rewrites solve assignments into explicit unpack assignments', () => {
  const normalized = normalizeAssistantMathSource('x := solve(5*x^2 - 2*x - 3 = 0, x)');
  assert.equal(normalized, 'x_1, x_2 := solve(5*x^2 - 2*x - 3 = 0, x)');
});

test('normalizeAssistantMathSource rewrites assignment derivations and resolves indexed plus-minus branches', () => {
  const normalized = normalizeAssistantMathSource(
    'x_1 := (-b - sqrt(D)) / (2a) = -(-2) ± sqrt(64) / (2 * 5) = (2 ± 8) / 10'
  );
  assert.equal(
    normalized,
    'x_1 := (-b - sqrt(D)) / (2*a)\nx_1 = -(-2) - sqrt(64) / (2 * 5)\nx_1 = (2 - 8) / 10'
  );
});

test('normalizeAssistantMathSource drops prose-only lines and keeps explicit example equations', () => {
  const normalized = normalizeAssistantMathSource('En vinkel som hører til linie med hældning -1/3.\nFor eks.: y = -1/3 x.');
  assert.equal(normalized, 'y = -1/3*x');
});

test('normalizeAssistantMathSource rewrites center and radius prose into assignments', () => {
  const normalized = normalizeAssistantMathSource('Centrum er (1, -2) og radius er 4.');
  assert.equal(normalized, 'center := (1, -2)\nradius := 4');
});

test('normalizeAssistantMathSource rewrites tuple summaries into explicit point assignments', () => {
  const normalized = normalizeAssistantMathSource('Punkterne er da hhv. (-3/5, 4/5) og (1, 4)');
  assert.equal(normalized, 'p_1 := (-3/5, 4/5)\np_2 := (1, 4)');
});

test('normalizeAssistantMathSource keeps indexed identifiers intact in equation follow-up lines', () => {
  const normalized = normalizeAssistantMathSource(
    'distance_p_1p_2 := sqrt((1 - (-3/5))^2 + (4 - 4/5)^2)\ndistance_p_1p_2 = sqrt((8/5)^2 + (16/5)^2)'
  );
  assert.equal(
    normalized,
    'distance_p_1p_2 := sqrt((1 - (-3/5))^2 + (4 - 4/5)^2)\ndistance_p_1p_2 = sqrt((8/5)^2 + (16/5)^2)'
  );
});

test('normalizeAssistantMathSource does not split short identifier names like eq inside solve calls', () => {
  const normalized = normalizeAssistantMathSource('eq := (x - 1)^2 = 4\nsolutions := solve(eq, x)');
  assert.equal(normalized, 'eq := (x - 1)^2 = 4\nsolutions := solve(eq, x)');
});

test('collectAssistantPhotoImportSuspiciousIdentifiers flags OCR-style variable names', () => {
  const suspicious = collectAssistantPhotoImportSuspiciousIdentifiers(
    'en_hvilken_som_hestlinje := y = -1/3*x\nintersection := (3, 2)\np1 := (0, 0)'
  );
  assert.deepEqual(suspicious, ['en_hvilken_som_hestlinje']);
});

test('collectAssistantPhotoImportSuspiciousIdentifiers allows compact math identifiers', () => {
  const suspicious = collectAssistantPhotoImportSuspiciousIdentifiers(
    'eq := (x - 1)^2 = 4\nx1 := -3/5\ny1 := 4/5\np1 := (x1, y1)\ndistance_p1_p2 := sqrt((x2 - x1)^2 + (y2 - y1)^2)'
  );
  assert.deepEqual(suspicious, []);
});

test('getAssistantPhotoImportMarkdownIssue requires a short idea sentence below the heading', () => {
  assert.equal(getAssistantPhotoImportMarkdownIssue('## Opg 1'), 'Markdown cell should include one short idea sentence under the heading.');
  assert.equal(getAssistantPhotoImportMarkdownIssue('## Opg 1\nFind the line from a point and slope.'), null);
});

test('collectPhotoImportStructureDiagnostics flags markdown-only drafts that carry the derivation', () => {
  const diagnostics = collectPhotoImportStructureDiagnostics({
    summary: 'draft',
    userMessage: '',
    warnings: [],
    operations: [
      {
        type: 'insert_cell',
        index: 0,
        cellType: 'markdown',
        source:
          '## Opg 1\nIdea note.\n- x = 1\n- y = 2\n- p = (1, 2)\n- distance = 3'
      }
    ],
    outline: {
      summary: 'draft',
      steps: []
    },
    steps: []
  });
  assert.match(diagnostics[0]?.reason || '', /must include Math cells/);
  assert.match(diagnostics[1]?.reason || '', /too much derivation detail/);
});
