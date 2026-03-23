import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCodeSymbols,
  extractMathSymbols,
  mergeEditorCompletions,
  type EditorCompletionItem
} from './editorSymbols.ts';

const labels = (items: EditorCompletionItem[]) => items.map((item) => item.label);

test('extractCodeSymbols finds assignments, defs, classes, imports, and loop targets', () => {
  const symbols = extractCodeSymbols(
    [
      'import numpy as np',
      'from math import sqrt as root, sin',
      'value = 2',
      'for item, idx in pairs:',
      '    pass',
      'class Lesson:',
      '    pass',
      'def velocity(distance, time):',
      '    return distance / time'
    ].join('\n')
  );

  const found = labels(symbols);
  assert.deepEqual(found, ['velocity', 'Lesson', 'root', 'sin', 'np', 'item', 'idx', 'value']);
});

test('extractMathSymbols finds assignments, function assignments, and identifiers', () => {
  const symbols = extractMathSymbols(
    [
      'f(x) := x^2 + offset',
      'offset := 3',
      'solutions := solve(f(x) = 12, x)',
      'x_1, x_2 := solutions'
    ].join('\n')
  );

  assert.deepEqual(labels(symbols), ['f', 'x', 'offset', 'solutions', 'x_1', 'x_2']);
});

test('mergeEditorCompletions dedupes labels and keeps the highest boost item', () => {
  const merged = mergeEditorCompletions(
    [{ label: 'solve', detail: 'builtin', boost: 100, type: 'function' }],
    [{ label: 'solve', detail: 'notebook', boost: 250, type: 'function', snippet: 'solve(${})' }],
    [{ label: 'offset', detail: 'symbol', boost: 200, type: 'variable' }]
  );

  assert.equal(merged[0]?.label, 'solve');
  assert.equal(merged[0]?.detail, 'notebook');
  assert.equal(merged[1]?.label, 'offset');
});
