import { StreamLanguage } from '@codemirror/language';

const BUILTIN_HELPERS = new Set([
  'Eq',
  'N',
  'abs',
  'acos',
  'asin',
  'atan',
  'cos',
  'exp',
  'expand',
  'factor',
  'linsolve',
  'ln',
  'log',
  'plot',
  'render_decimal',
  'render_exact',
  'set_decimal_places',
  'simplify',
  'sin',
  'solve',
  'sqrt',
  'subs',
  'tan'
]);

const CONSTANTS = new Set(['pi', 'e', 'oo']);

const OPERATORS = /^(?:\:=|==|!=|<=|>=|\^|=|\+|-|\*|\/|,|:)/;

const mathMode = StreamLanguage.define({
  startState() {
    return {};
  },
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(OPERATORS)) {
      const current = stream.current();
      if (current === '==' || current === '!=' || current === '<=' || current === '>=') {
        return 'invalid';
      }
      return 'operator';
    }
    if (stream.match(/^[()[\]{}]/)) return 'bracket';
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/^"[^"]*"?/) || stream.match(/^'[^']*'?/)) return 'string';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const current = stream.current();
      const lookahead = stream.string.slice(stream.pos).match(/^\s*([()[\]{}]|:=|=)?/);
      const nextToken = lookahead?.[1] ?? '';
      if (BUILTIN_HELPERS.has(current)) return 'keyword';
      if (CONSTANTS.has(current)) return 'atom';
      if (nextToken === '(') return 'propertyName';
      return 'variableName';
    }
    stream.next();
    return null;
  }
});

export const sugarPyMathLanguage = mathMode;
