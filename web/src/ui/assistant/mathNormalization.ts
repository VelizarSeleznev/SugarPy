import type { AssistantOperation } from './types';
import type { AssistantCellKind, AssistantPlan } from '../utils/assistant';

export type AssistantMathNormalizationDiagnostic = {
  operationIndex: number;
  originalSource: string;
  normalizedSource: string;
  reason: string;
};

const ASSISTANT_PLAN_DIAGNOSTICS = Symbol('assistantPlanDiagnostics');

const findTopLevelEquationBreaks = (line: string) => {
  const positions: number[] = [];
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char !== '=' || depth !== 0) continue;
    const prev = line[index - 1] || '';
    const next = line[index + 1] || '';
    if (prev === ':' || prev === '<' || prev === '>' || prev === '!' || next === '=') continue;
    positions.push(index);
  }
  return positions;
};

const sanitizeAssistantMathIdentifier = (value: string) =>
  value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .replace(/^[0-9]/, 'v_$&')
    .toLowerCase();

const buildAssistantIndexedName = (name: string, index: number) => `${sanitizeAssistantMathIdentifier(name)}_${index}`;

const normalizeAssistantMathRhs = (value: string) =>
  value
    .replace(/Δ([A-Za-z_][A-Za-z0-9_]*)/g, 'delta_$1')
    .replace(/\b([A-Za-z])([A-Za-z])\b/g, (match, left: string, right: string) => {
      const token = `${left}${right}`.toLowerCase();
      return token === 'eq' || token === 'pi' ? match : `${left}*${right}`;
    })
    .replace(/(?<![A-Za-z0-9_])(\d|\))(?=[A-Za-z_(])/g, '$1*')
    .replace(/(\d|\))\s+(sqrt\s*\()/g, '$1*$2')
    .replace(/(?<![A-Za-z0-9_])(\d|\))\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*\()?)/g, '$1*$2');

const extractAssistantMathLhs = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const assignIndex = trimmed.indexOf(':=');
  if (assignIndex >= 0) return trimmed.slice(0, assignIndex).trim();
  const breaks = findTopLevelEquationBreaks(trimmed);
  if (breaks.length === 0) return '';
  return trimmed.slice(0, breaks[0]).trim();
};

const splitPlusMinusExpression = (expression: string) => {
  const index = expression.indexOf('±');
  if (index < 0) return null;
  return {
    minus: `${expression.slice(0, index)}-${expression.slice(index + 1)}`.replace(/\s+/g, ' ').trim(),
    plus: `${expression.slice(0, index)}+${expression.slice(index + 1)}`.replace(/\s+/g, ' ').trim()
  };
};

const resolveAssistantIndexedPlusMinus = (expression: string, lhs: string) => {
  if (!expression.includes('±')) return expression;
  const suffix = lhs.match(/_(\d+)$/)?.[1];
  if (suffix === '1') return expression.replace(/±/g, '-');
  if (suffix === '2') return expression.replace(/±/g, '+');
  return expression;
};

const rewriteAssistantProseLine = (line: string) => {
  const exampleMatch = line.match(/^\s*(?:For\s+eks\.?|For\s+example)\s*:\s*(.+)$/i);
  if (exampleMatch) {
    return [normalizeAssistantMathRhs((exampleMatch[1] || '').trim().replace(/\.$/, ''))];
  }

  const centerRadiusMatch = line.match(
    /^\s*(?:Vi\s+ser(?:\s+på\s+tegning)?\s+at\s+)?[Cc]entrum(?:\s+er)?\s*(\([^)]+\)).*?\b(?:og|and)\b.*?\bradius(?:\s+er)?\s*([A-Za-z0-9_()./+*\- ]+)\.?\s*$/i
  );
  if (centerRadiusMatch) {
    return [`center := ${centerRadiusMatch[1]}`, `radius := ${normalizeAssistantMathRhs((centerRadiusMatch[2] || '').trim())}`];
  }

  const pointPairMatch = line.match(/^\s*Punkterne.*?(\([^)]+\)).*?(?:og|and)\s*(\([^)]+\))\s*\.?\s*$/i);
  if (pointPairMatch) {
    return [`p_1 := ${pointPairMatch[1]}`, `p_2 := ${pointPairMatch[2]}`];
  }

  const intersectionMatch = line.match(/^\s*Skæringspunkt(?:et)?(?:\s+er(?:\s+\w+)?)?\s*(\([^)]+\))\s*\.?\s*$/i);
  if (intersectionMatch) {
    return [`intersection := ${intersectionMatch[1]}`];
  }

  const centerOnlyMatch = line.match(/^\s*Centrum(?:\s+er)?\s*(\([^)]+\))\s*\.?\s*$/i);
  if (centerOnlyMatch) {
    return [`center := ${centerOnlyMatch[1]}`];
  }

  const radiusOnlyMatch = line.match(/^\s*Radius(?:\s+er)?\s*([A-Za-z0-9_()./+*\- ]+)\.?\s*$/i);
  if (radiusOnlyMatch) {
    return [`radius := ${normalizeAssistantMathRhs((radiusOnlyMatch[1] || '').trim())}`];
  }

  const proseKeywordIndex = line.search(/\b(?:være|where|with|som)\b/i);
  if (proseKeywordIndex > 0) {
    const prefix = line.slice(0, proseKeywordIndex).trim();
    if (/[=:]/.test(prefix)) {
      return [normalizeAssistantMathRhs(prefix)];
    }
  }

  if (line.startsWith('#')) return [];
  if (!/[=:()^]/.test(line) && /[A-Za-zÆØÅæøå]/.test(line)) return [];
  return null;
};

export const normalizeAssistantMathSource = (source: string) => {
  const normAssignments = new Map<string, string>();
  let previousLhs = '';
  let bareTupleIndex = 0;
  let expectRadiusAfterCenter = false;
  const normalizedLines = source.split('\n').flatMap((rawLine) => {
    const line = rawLine.trim().replace(/\.$/, '');
    const indent = rawLine.match(/^\s*/)?.[0] ?? '';
    if (!line) {
      previousLhs = '';
      bareTupleIndex = 0;
      expectRadiusAfterCenter = false;
      return [rawLine];
    }

    const proseRewrite = rewriteAssistantProseLine(line);
    if (proseRewrite) {
      const cleaned = proseRewrite.map((entry) => entry.trim()).filter(Boolean).map((entry) => `${indent}${entry}`);
      if (cleaned.some((entry) => entry.includes('center :='))) {
        expectRadiusAfterCenter = true;
      } else if (cleaned.length > 0) {
        expectRadiusAfterCenter = false;
      }
      if (cleaned.length > 0) {
        previousLhs = extractAssistantMathLhs(cleaned[cleaned.length - 1] || '');
      }
      return cleaned;
    }

    if (line.startsWith('=') && previousLhs) {
      const rhs = normalizeAssistantMathRhs(line.slice(1).trim());
      expectRadiusAfterCenter = false;
      return [`${indent}${previousLhs} = ${rhs}`];
    }

    const normMatch = rawLine.match(/^\s*\|([^|]+)\|\s*=\s*(.+)$/);
    if (normMatch) {
      const normLabel = sanitizeAssistantMathIdentifier(normMatch[1] || 'distance');
      const seenBefore = normAssignments.has(normLabel);
      const variableName = normAssignments.get(normLabel) || `distance_${normLabel}`;
      normAssignments.set(normLabel, variableName);
      previousLhs = variableName;
      const rhs = normalizeAssistantMathRhs((normMatch[2] || '').trim());
      const operator = seenBefore ? '=' : ':=';
      expectRadiusAfterCenter = false;
      return [`${indent}${variableName} ${operator} ${rhs}`];
    }

    const explicitAlternativeMatch = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s+[vV]\s+\1\s*=\s*(.+)$/);
    if (explicitAlternativeMatch) {
      const variableName = sanitizeAssistantMathIdentifier(explicitAlternativeMatch[1] || 'value');
      const first = normalizeAssistantMathRhs((explicitAlternativeMatch[2] || '').trim());
      const second = normalizeAssistantMathRhs((explicitAlternativeMatch[3] || '').trim());
      previousLhs = buildAssistantIndexedName(variableName, 2);
      expectRadiusAfterCenter = false;
      return [
        `${indent}${buildAssistantIndexedName(variableName, 1)} := ${first}`,
        `${indent}${buildAssistantIndexedName(variableName, 2)} := ${second}`
      ];
    }

    const trailingAlternativeMatch = rawLine.match(/^\s*\(([^)]+)\)\s+[vV]\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (trailingAlternativeMatch) {
      const variableName = sanitizeAssistantMathIdentifier(trailingAlternativeMatch[2] || 'value');
      const first = normalizeAssistantMathRhs((trailingAlternativeMatch[1] || '').trim());
      const second = normalizeAssistantMathRhs((trailingAlternativeMatch[3] || '').trim());
      previousLhs = buildAssistantIndexedName(variableName, 2);
      expectRadiusAfterCenter = false;
      return [
        `${indent}${buildAssistantIndexedName(variableName, 1)} := ${first}`,
        `${indent}${buildAssistantIndexedName(variableName, 2)} := ${second}`
      ];
    }

    const solveAssignmentMatch = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(solve\((.+),\s*\1\s*\))\s*$/i);
    if (solveAssignmentMatch) {
      const variableName = sanitizeAssistantMathIdentifier(solveAssignmentMatch[1] || 'value');
      previousLhs = buildAssistantIndexedName(variableName, 2);
      expectRadiusAfterCenter = false;
      return [
        `${indent}${buildAssistantIndexedName(variableName, 1)}, ${buildAssistantIndexedName(variableName, 2)} := ${normalizeAssistantMathRhs(
          solveAssignmentMatch[2] || ''
        )}`
      ];
    }

    const plusMinusMatch = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (plusMinusMatch) {
      const split = splitPlusMinusExpression(plusMinusMatch[2] || '');
      if (split) {
        const variableName = sanitizeAssistantMathIdentifier(plusMinusMatch[1] || 'value');
        previousLhs = buildAssistantIndexedName(variableName, 2);
        expectRadiusAfterCenter = false;
        return [
          `${indent}${buildAssistantIndexedName(variableName, 1)} := ${normalizeAssistantMathRhs(split.minus)}`,
          `${indent}${buildAssistantIndexedName(variableName, 2)} := ${normalizeAssistantMathRhs(split.plus)}`
        ];
      }
    }

    if (line.includes(':=')) {
      const assignIndex = line.indexOf(':=');
      const lhs = line.slice(0, assignIndex).trim();
      const rhs = line.slice(assignIndex + 2).trim();
      const breaks = findTopLevelEquationBreaks(rhs);
      if (breaks.length > 1) {
        const segments = rhs.split('=').map((part) => part.trim()).filter(Boolean);
        if (segments.length > 0) {
          const resolvedSegments = segments.map((segment) =>
            normalizeAssistantMathRhs(resolveAssistantIndexedPlusMinus(segment, lhs))
          );
          previousLhs = lhs;
          expectRadiusAfterCenter = false;
          return [
            `${indent}${lhs} := ${resolvedSegments[0]}`,
            ...resolvedSegments.slice(1).map((segment) => `${indent}${lhs} = ${segment}`)
          ];
        }
      }
      const normalized = `${indent}${lhs} := ${normalizeAssistantMathRhs(resolveAssistantIndexedPlusMinus(rhs, lhs))}`;
      previousLhs = extractAssistantMathLhs(normalized);
      expectRadiusAfterCenter = false;
      return [normalized];
    }

    if (/^\([^)]+\)$/.test(line)) {
      if (expectRadiusAfterCenter) {
        previousLhs = 'center';
        expectRadiusAfterCenter = true;
        return [`${indent}center := ${line}`];
      }
      bareTupleIndex += 1;
      previousLhs = `p_${bareTupleIndex}`;
      expectRadiusAfterCenter = false;
      return [`${indent}p_${bareTupleIndex} := ${line}`];
    }

    if (expectRadiusAfterCenter && /^[0-9.+\-/*\s]+$/.test(line)) {
      previousLhs = 'radius';
      expectRadiusAfterCenter = false;
      return [`${indent}radius := ${normalizeAssistantMathRhs(line)}`];
    }

    const breaks = findTopLevelEquationBreaks(rawLine);
    if (breaks.length <= 1) {
      const normalized = `${indent}${normalizeAssistantMathRhs(line)}`;
      previousLhs = extractAssistantMathLhs(normalized);
      expectRadiusAfterCenter = false;
      return [normalized];
    }

    const segments = rawLine.split('=').map((part) => part.trim()).filter(Boolean);
    if (segments.length <= 2) {
      const normalized = `${indent}${normalizeAssistantMathRhs(line)}`;
      previousLhs = extractAssistantMathLhs(normalized);
      expectRadiusAfterCenter = false;
      return [normalized];
    }

    const splitLines: string[] = [];
    for (let index = 0; index < segments.length - 1; index += 1) {
      splitLines.push(`${indent}${normalizeAssistantMathRhs(segments[index])} = ${normalizeAssistantMathRhs(segments[index + 1])}`);
    }
    previousLhs = extractAssistantMathLhs(splitLines[splitLines.length - 1] || '');
    expectRadiusAfterCenter = false;
    return splitLines;
  });

  return normalizedLines.join('\n');
};

const ASSISTANT_MATH_ALLOWED_WORDS = new Set([
  'a', 'b', 'c', 'd', 'x', 'y', 'l', 'r', 'D', 'L', 'sqrt', 'solve', 'Eq', 'N',
  'render_decimal', 'render_exact', 'set_decimal_places', 'center', 'radius', 'intersection',
  'point', 'distance', 'distance_p1p2'
]);

const ASSISTANT_PHOTO_IMPORT_PREFERRED_IDENTIFIERS = [
  /^a$/i, /^b$/i, /^c$/i, /^d$/i, /^x$/i, /^y$/i, /^r$/i, /^l$/i, /^eq\d*$/i, /^line\d*$/i,
  /^slope\d*$/i, /^circle\d*$/i, /^center\d*$/i, /^radius\d*$/i, /^intersection\d*$/i,
  /^distance(?:_[a-z0-9]+)*$/i, /^point\d*$/i, /^solution(?:s)?\d*$/i, /^result\d*$/i,
  /^answer\d*$/i, /^x_?\d+$/i, /^y_?\d+$/i, /^p_?\d+$/
] as const;

export const lineHasAssistantMathProse = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  const words = trimmed.match(/[A-Za-zÆØÅæøå_]+/g) ?? [];
  if (words.length === 0) return false;
  const suspiciousWords = words.filter((word) => {
    if (ASSISTANT_MATH_ALLOWED_WORDS.has(word)) return false;
    if (/^[A-Za-z]_\d+$/.test(word)) return false;
    if (/^[A-Za-z]$/.test(word)) return false;
    if (/^[a-z]+_[a-z0-9_]+$/i.test(word)) return false;
    return word.length > 1;
  });
  return suspiciousWords.length >= 2 || /:\s*$/.test(trimmed);
};

const extractAssistantMathAssignedIdentifiers = (source: string) =>
  source
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => {
      if (!line.includes(':=')) return [];
      const lhs = line.slice(0, line.indexOf(':=')).trim();
      return lhs
        .split(',')
        .map((part) => part.trim().replace(/^\(|\)$/g, ''))
        .filter(Boolean);
    });

export const collectAssistantPhotoImportSuspiciousIdentifiers = (source: string) =>
  Array.from(
    new Set(
      extractAssistantMathAssignedIdentifiers(source).filter((identifier) => {
        if (!identifier) return false;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) return true;
        if (ASSISTANT_PHOTO_IMPORT_PREFERRED_IDENTIFIERS.some((pattern) => pattern.test(identifier))) return false;
        if (/[^A-Za-z0-9_]/.test(identifier)) return true;
        if (identifier.length > 20) return true;
        if ((identifier.match(/_/g) || []).length >= 3 && !identifier.startsWith('distance_')) return true;
        if (!/^[\x00-\x7F]+$/.test(identifier)) return true;
        return /^[A-Za-z]+(?:_[A-Za-z]+)+$/.test(identifier);
      })
    )
  );

export const getAssistantPhotoImportMarkdownIssue = (source: string) => {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headingLines = lines.filter((line) => line.startsWith('#'));
  const noteLines = lines.filter((line) => !line.startsWith('#'));
  if (headingLines.length === 0) return 'Markdown cell should include a short heading for the imported problem.';
  if (noteLines.length === 0) return 'Markdown cell should include one short idea sentence under the heading.';
  const noteText = noteLines.join(' ').trim();
  const sentenceCount = noteText.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
  if (sentenceCount > 2) return 'Markdown idea note should stay at one or two short sentences.';
  if (noteText.length > 180) return 'Markdown idea note is too long; keep it brief and paper-style.';
  return null;
};

export const getPlanDiagnostics = (plan: AssistantPlan) =>
  ((plan as AssistantPlan & { [ASSISTANT_PLAN_DIAGNOSTICS]?: AssistantMathNormalizationDiagnostic[] })[
    ASSISTANT_PLAN_DIAGNOSTICS
  ] ?? []) as AssistantMathNormalizationDiagnostic[];

export const attachPlanDiagnostics = (plan: AssistantPlan, diagnostics: AssistantMathNormalizationDiagnostic[]) => {
  (plan as AssistantPlan & { [ASSISTANT_PLAN_DIAGNOSTICS]?: AssistantMathNormalizationDiagnostic[] })[
    ASSISTANT_PLAN_DIAGNOSTICS
  ] = diagnostics;
  return plan;
};

export const collectPhotoImportStructureDiagnostics = (plan: AssistantPlan): AssistantMathNormalizationDiagnostic[] => {
  const diagnostics: AssistantMathNormalizationDiagnostic[] = [];
  const insertOperations = plan.operations.filter((operation) => operation.type === 'insert_cell');
  const markdownOps = insertOperations.filter(
    (operation): operation is Extract<AssistantOperation, { type: 'insert_cell' }> =>
      operation.type === 'insert_cell' && operation.cellType === 'markdown'
  );
  const mathOps = insertOperations.filter(
    (operation): operation is Extract<AssistantOperation, { type: 'insert_cell' }> =>
      operation.type === 'insert_cell' && operation.cellType === 'math'
  );

  if (mathOps.length === 0) {
    diagnostics.push({
      operationIndex: -1,
      originalSource: '',
      normalizedSource: '',
      reason: 'Photo-import plan must include Math cells for the actual CAS derivation, not only Markdown notes.'
    });
  }

  markdownOps.forEach((operation, index) => {
    const bulletLines = operation.source.split('\n').filter((line) => line.trim().startsWith('- '));
    const codeLikeLines = operation.source.split('\n').filter((line) => /`.+`/.test(line) || /:=|=\s*.+/.test(line));
    if (bulletLines.length >= 4 || codeLikeLines.length >= 4 || operation.source.length > 320) {
      diagnostics.push({
        operationIndex: index,
        originalSource: operation.source,
        normalizedSource: operation.source,
        reason: 'Markdown cell is carrying too much derivation detail; keep the idea short and move the actual math into a Math cell.'
      });
    }
  });

  return diagnostics;
};
