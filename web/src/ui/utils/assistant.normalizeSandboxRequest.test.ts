import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSandboxRequest } from './assistant.ts';

test('normalizeSandboxRequest uses math code as sandbox source when source is only a label', () => {
  const request = normalizeSandboxRequest({
    target: 'math',
    code: 'line := y = 0.5*x + 0.5\ncircle := (x - 2)^2 + (y - 1)^2 = 9\nsolutions := solve((line, circle), (x, y))\nsolutions',
    source: 'validation plot',
    contextPreset: 'selected-cells',
    selectedCellIds: [],
    timeoutMs: 5000
  });

  assert.equal(request.target, 'math');
  assert.equal(request.code, 'line := y = 0.5*x + 0.5\ncircle := (x - 2)^2 + (y - 1)^2 = 9\nsolutions := solve((line, circle), (x, y))\nsolutions');
  assert.equal(request.source, request.code);
  assert.notEqual(request.source, 'validation plot');
});

test('normalizeSandboxRequest preserves source for non-math sandbox requests', () => {
  const request = normalizeSandboxRequest({
    target: 'code',
    code: 'print("hello")',
    source: 'validation',
    contextPreset: 'bootstrap-only',
    selectedCellIds: [],
    timeoutMs: 5000
  });

  assert.equal(request.target, 'code');
  assert.equal(request.code, 'print("hello")');
  assert.equal(request.source, 'validation');
});
