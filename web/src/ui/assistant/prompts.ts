import type {
  AssistantCellKind,
  AssistantConversationEntry,
  AssistantPhotoImportInput,
  AssistantPlan,
  AssistantPreference,
  AssistantScope,
  NotebookAssistantContext,
  NotebookCellSnapshot
} from '../utils/assistant';
import type { AssistantMathNormalizationDiagnostic } from './mathNormalization';

export const COMPACT_REFERENCE = [
  'SugarPy compact reference:',
  '- Cell types: code, markdown, math, stoich, regression.',
  '- Math cells are CAS-style, not Python-style.',
  '- In Math cells: = means equation, := means assignment, ^ is exponent, implicit multiplication works.',
  '- name := expr assigns a value or symbolic expression to a name; it does not define a callable function.',
  '- name(arg) := expr defines a callable Math-cell function.',
  '- Supported Math-cell input kinds: expression, equation, assignment, unpack assignment, function assignment.',
  '- Multiple statements per Math cell are allowed and run top-to-bottom in the same namespace.',
  '- Math cells share namespace with Code cells.',
  '- Notebook defaults include trig mode (deg/rad) and render mode (exact/decimal).',
  '- Each Math cell may override trig/render mode.',
  '- Built-in Math helpers include Eq(...), solve(...), linsolve(...), simplify(...), expand(...), factor(...), N(...), render_decimal(...), render_exact(...), set_decimal_places(...), plot(...).',
  '- Inline equations are accepted directly inside CAS calls. Preferred system-solve form: solve((eq1, eq2), (x, y)) or solve(equation1, equation2, (x, y)).',
  '- Assigned equation forms such as eq1 := a = b and eq1 := Eq(a, b) are supported, but ordered tuple/direct-argument solve(...) forms are still preferred over set literals.',
  '- For assistant-generated multi-equation solves, prefer tuple/ordered equation arguments over set literals { ... }.',
  '- If solve(...) returns structured points, unpack them with documented forms such as (h1, k1), (h2, k2) := solutions.',
  '- Math container results such as solve(...) solution lists render as LaTeX; prefer showing them directly before extra manipulation.',
  '- render_decimal(expr, places?) rounds by decimal places; render_exact(expr) forces symbolic display.',
  '- In Math cells, prefer Maple-style plot ranges: x = a..b and y = c..d.',
  '- Supported plotting options include xmin, xmax, ymin, ymax, equal_axes, showlegend, and title.',
  '- Compatibility plot range forms such as plot(circle, (x, -8, 12), (y, 20, 40), equal_axes=True) are accepted.',
  '- In a single plot(...) call, choose exactly one range style: Maple-style x = a..b / y = c..d, compatibility tuples like (x, a, b), or xmin/xmax/ymin/ymax kwargs. Do not mix them.',
  '- Use only documented SugarPy Math syntax; avoid unsupported lambda or arrow-function notation.',
  '- For teaching notebooks, prefer explicit equations, unpack assignment, and direct symbolic expressions over helper-heavy transformations.',
  '- Safe plotting defaults for geometry: prefer implicit equations or directly plottable expressions.',
  '- For circles and geometry, prefer circle := equation and then plot(circle, ..., equal_axes=True).',
  '- Equation assignments used for plotting are stored internally in = 0 form for CAS work.',
  '- Do not rely on trig parameterizations unless the user explicitly asks for them.',
  '- Trig expressions in Math cells depend on Deg/Rad mode.',
  '- If a graph is requested, generate notebook content that actually renders the graph in SugarPy.',
  '- Stoich cells are for chemistry tables, not generic math.',
  '- Prefer CAS-first outputs when the task is naturally symbolic or equation-based.'
].join('\n');

export const REFERENCE_SECTIONS = {
  overview: [
    'SugarPy product overview:',
    '- Notebook app with code, markdown, math, stoich, and regression cells.',
    '- Optional AI assistant edits notebook cells through structured operations.',
    '- Run All executes code, math, stoich, and regression cells top-to-bottom.',
    '- Header defaults include Degrees/Radians and Exact/Decimal for Math cells.'
  ].join('\n'),
  math_cells: [
    'Math cell reference:',
    '- CAS-style input over SymPy.',
    '- = means equation; := means assignment.',
    '- name := expr stores a value or symbolic expression under that name.',
    '- name(arg) := expr defines a callable function.',
    '- ^ is exponent; implicit multiplication works.',
    '- Supported input kinds: expression, equation, assignment, unpack assignment, function assignment.',
    '- Unpack assignment examples: a0, b0 := solO[1] and (h1, k1), (h2, k2) := solutions.',
    '- Multiple statements per cell are allowed.',
    '- Math cells share namespace with Code cells.',
    '- Trig mode is deg or rad and affects trig evaluation.',
    '- Built-in helpers: Eq(...), solve(...), linsolve(...), simplify(...), expand(...), factor(...), N(...), render_decimal(...), render_exact(...), set_decimal_places(...).',
    '- Inline equations are accepted inside CAS calls. Prefer solve((equation1, equation2), (x, y)) over undocumented variants.',
    '- Assistant-safe multi-equation solve pattern: write explicit equations inline and pass an ordered tuple or direct equation arguments to solve(...).',
    '- Assigned equation forms such as eq1 := a = b and eq1 := Eq(a, b) are both supported, but ordered tuple/direct-argument solve(...) forms are preferred over set literals.',
    '- Prefer plain = equations when they are enough; Eq(...) is supported for compatibility, not the default assistant notation.',
    '- Function definitions are lazy at declaration time: f(x) := expr should be treated as a declaration, not as something to immediately execute or expand.',
    '- If both exact and decimal views are needed in one cell, wrap each line explicitly with render_exact(...) or render_decimal(...).',
    '- render_decimal(...) rounds by decimal places, not significant digits.',
    '- Container results such as solve(...) solution lists/points render as LaTeX, so showing them directly is acceptable and often clearer.',
    '- Prefer Math cells for symbolic equations, solve, expand, factor, N, and plot workflows.',
    '- Prefer direct symbolic expressions and documented solve(...) results over helper-heavy transformations.',
    '- Out of scope in Math cells: Python def blocks, lambda syntax, arrow syntax, Python loops/comprehensions, and undocumented helper functions.'
  ].join('\n'),
  plotting: [
    'Plotting reference:',
    '- plot(...) works in Code and Math cells.',
    '- In Math cells, prefer Maple-style ranges: plot(expr, x = a..b, y = c..d, ...).',
    '- Also supported: xmin/xmax/ymin/ymax kwargs, and compatibility range tuples like (x, a, b).',
    '- Supported options include xmin, xmax, ymin, ymax, equal_axes, showlegend, title.',
    '- Use one range style per plot call; do not mix Maple-style ranges, compatibility tuples, and xmin/xmax/ymin/ymax kwargs in the same plot(...).',
    '- Geometry-safe pattern: store an implicit equation assignment, then call plot(name, ...).',
    '- Example: circle := (x-2)^2 + (y+10)^2 = 25; plot(circle, x = -5..9, y = 3..17, equal_axes=True).',
    '- Equation assignments used for implicit plots are stored internally in = 0 form for CAS work.',
    '- For 1-2 traces the legend is shown by default; showlegend=True|False can override this.',
    '- title="..." is supported but should be used only when it materially helps the notebook.',
    '- Double-clicking the graph resets to the initial requested range.',
    '- Do not assume parametric plotting support from plot(x(t), y(t), t=...).',
    '- Trig-based plotting in Math cells depends on the Deg/Rad mode.',
    '- If a non-trig form exists, prefer it.'
  ].join('\n'),
  cell_types: [
    'Cell type reference:',
    '- code: Python execution.',
    '- markdown: text/notes.',
    '- math: CAS symbolic input with rendered math card.',
    '- stoich: chemistry stoichiometry table over a reaction.',
    '- regression: compact x/y data table with fitted regression graph.'
  ].join('\n'),
  assistant: [
    'Assistant behavior reference:',
    '- Return structured notebook operations only.',
    '- Prefer minimal, directly runnable edits.',
    '- Respect user preference mode: auto, cas, python, explain.',
    '- Use CAS-first when the task is naturally equation-based or symbolic.',
    '- Avoid mathematically valid but SugarPy-incompatible representations.'
  ].join('\n')
} as const;

export const MATH_ASSISTANT_SPEC = [
  'Math-cell assistant spec:',
  '- Use only documented SugarPy Math syntax.',
  '- Supported statement types: expression, equation, assignment, unpack assignment, function assignment.',
  '- Use = for equations and := for assignment.',
  '- Preferred helpers: Eq(...), solve(...), linsolve(...), simplify(...), expand(...), factor(...), subs(...), N(...), render_decimal(...), render_exact(...), set_decimal_places(...), plot(...).',
  '- Multiple statements per Math cell are allowed and run top-to-bottom.',
  '- For teaching notebooks, prefer explicit equations, unpack assignment, direct arithmetic, and direct symbolic expressions.',
  '- Inline equations are accepted inside CAS calls; for systems, prefer solve((equation1, equation2), (x, y)) or another documented ordered form.',
  '- Assigned equation forms such as eq1 := a = b and eq1 := Eq(a, b) are supported, but ordered tuple/direct-argument solve(...) forms are preferred over set literals.',
  '- If solve(...) returns structured points, unpack them with documented assignment forms such as (h1, k1), (h2, k2) := solutions.',
  '- For one-variable solve(...) results, avoid guessing container indexes; instead show the solve result directly and verify with explicit symbolic expressions.',
  '- Prefer plain = equation syntax over Eq(...) unless Eq(...) is specifically needed for a documented helper pattern.',
  '- If both exact and decimal displays are needed in one cell, wrap lines explicitly with render_exact(...) or render_decimal(...).',
  '- render_decimal(...) rounds by decimal places, not significant digits.',
  '- Math container results render readably; it is fine to show solutions directly before unpacking or plotting.',
  '- subs(...) is supported for post-processing symbolic results, but prefer simpler direct symbolic expressions or direct solve(...) output when they are clearer.',
  '- Forbidden: ->, lambda, map(...), Python comprehensions, Python loops, def blocks, and undocumented helper functions.',
  '- If plotting is needed, prefer implicit equations or directly plottable expressions with Maple-style ranges x = a..b and y = c..d.',
  '- Supported plot options include equal_axes, showlegend, title, xmin/xmax/ymin/ymax, and compatibility range tuple forms.',
  '- In one plot(...) call, use one range convention only; do not combine tuple ranges with xmin/xmax/ymin/ymax kwargs.'
].join('\n');

export const requestLooksLikeDirectGeometrySolve = (request: string) => {
  const normalized = request.toLowerCase();
  return (
    (normalized.includes('circle') || normalized.includes('окруж')) &&
    (normalized.includes('point') ||
      normalized.includes('точк') ||
      /\ba\(/.test(normalized) ||
      /\bb\(/.test(normalized) ||
      normalized.includes('radius') ||
      normalized.includes('радиус') ||
      normalized.includes('solve'))
  );
};

export const requestLooksMathLike = (request: string) => {
  const normalized = request.toLowerCase();
  return (
    /(math|equation|equations|solve|symbolic|algebra|geometry|circle|radius|plot|intersection)\b/.test(normalized) ||
    /(матем|уравн|реши|решить|решение|окруж|радиус|график|пересеч)/.test(normalized)
  );
};

export const requestExplicitlyAsksForPython = (request: string) => {
  const normalized = request.toLowerCase();
  return (
    /\bpython\b/.test(normalized) ||
    /\bsympy\b/.test(normalized) ||
    /\bcode cell\b/.test(normalized) ||
    /\bscript\b/.test(normalized) ||
    /\bprogram\b/.test(normalized) ||
    /питон|python|sympy|через python|на python|python-скрипт/.test(normalized)
  );
};

const buildPreferenceRules = (preference: AssistantPreference) => {
  switch (preference) {
    case 'cas':
      return [
        'Preference mode: CAS-first.',
        'Prefer Math cells over Code cells when the task can be expressed naturally in SugarPy CAS.',
        'Prefer equations, assignments, symbolic transformations, and SugarPy plot(...) workflows over Python implementations.',
        'Avoid Python helper functions unless they are required for the requested task.'
      ];
    case 'python':
      return [
        'Preference mode: Python-first.',
        'Prefer Code cells and ordinary Python/SymPy syntax over SugarPy CAS shorthand.',
        'Use Math cells only when the user explicitly wants CAS notation or symbolic card rendering.'
      ];
    case 'explain':
      return [
        'Preference mode: Explain-first.',
        'Prefer a short Markdown explanation plus the minimum runnable notebook content.',
        'Avoid adding extra implementation cells beyond what is necessary to answer the request.'
      ];
    default:
      return [
        'Preference mode: Auto.',
        'Default to CAS-first behavior.',
        'If the request is math, symbolic, equation-based, plotting-related, or naturally expressible in SugarPy Math cells, prefer Math cells over Code cells.',
        'Treat mathematical requests as Math-cell tasks by default; do not switch to Code cells unless CAS is clearly unsupported or the user explicitly asks for Python.',
        'Treat Code cells as a last resort for math requests, not as an equal alternative.',
        'Use Code cells only when the request is not really mathematical, when CAS is clearly a poor fit, or when the user explicitly asks for Python.'
      ];
  }
};

export const buildInspectionPrompt = (
  request: string,
  scope: AssistantScope,
  conversationHistory: AssistantConversationEntry[],
  photoImport?: AssistantPhotoImportInput
) => {
  const attachmentSummary = (photoImport?.items ?? [])
    .map((item) => item.displayName || item.fileName || `attachment ${item.pageNumber ?? ''}`.trim())
    .filter(Boolean)
    .join(', ');
  const recentConversation = conversationHistory
    .slice(-6)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join('\n');
  return [
    'You are helping edit a SugarPy notebook.',
    COMPACT_REFERENCE,
    'First inspect the notebook using the available tools before planning changes.',
    'Only inspect what you need. Prefer concise tool usage.',
    ...(requestLooksMathLike(request)
      ? [
          'This request looks mathematical or plotting-related.',
          'Before planning, consult the SugarPy references you need to confirm Math-cell and plotting behavior.',
          "Start with get_reference('math_cells') and, if plotting or geometry is involved, get_reference('plotting').",
          'Do not assume Python is needed before checking whether SugarPy Math cells already support the workflow.'
        ]
      : []),
    ...(photoImport
      ? [
          'An ordered set of uploaded handwritten images is attached to this request.',
          'Inspect the readable content of the attached pages and use them as source material for new notebook cells.',
          'Preserve the page order when reasoning about the attached material.',
          'Treat scratched-out or unreadable parts as uncertain instead of inventing content.',
          'Keep import behavior additive: append new cells rather than rewriting existing notebook cells.',
          "For imported math content, consult get_reference('math_cells') before planning."
        ]
      : []),
    `Scope preference: ${scope}.`,
    `User request: ${request}`,
    attachmentSummary ? `Attached pages/files: ${attachmentSummary}` : '',
    photoImport?.instructions?.trim() ? `Photo import instruction: ${photoImport.instructions.trim()}` : '',
    recentConversation ? `Recent conversation:\n${recentConversation}` : ''
  ]
    .filter(Boolean)
    .join('\n');
};

export const buildOpenAIPhotoImportInput = (text: string, photoImport: AssistantPhotoImportInput) => [
  {
    role: 'user' as const,
    content: [
      {
        type: 'input_text' as const,
        text
      },
      ...photoImport.items.map((item) => ({
        type: 'input_image' as const,
        image_url: item.imageDataUrl
      }))
    ]
  }
];

export const buildValidationPrompt = (
  request: string,
  context: NotebookAssistantContext,
  draftPlan: AssistantPlan,
  conversationHistory: AssistantConversationEntry[]
) =>
  JSON.stringify({
    userRequest: request,
    notebookName: context.notebookName,
    activeCellId: context.activeCellId,
    defaults: {
      trigMode: context.defaultTrigMode,
      renderMode: context.defaultMathRenderMode
    },
    conversationHistory: conversationHistory.slice(-6),
    draftPlan
  });

export const validationSystemPrompt = [
  'You are validating a drafted SugarPy notebook change set.',
  COMPACT_REFERENCE,
  'The live notebook has not been changed yet.',
  'You must use run_code_in_sandbox to self-check every runnable insert/update operation before returning the final plan.',
  'Use target=code for Python code cells and target=math for SugarPy Math cells.',
  'Sandbox execution is isolated and never mutates the notebook.',
  'A successful sandbox check means the code is valid for preview; actual notebook execution happens later when the user chooses Apply and Run.',
  'Do not claim that code execution is unavailable if sandbox validation succeeded.',
  'Default to contextPreset bootstrap-only unless the draft truly depends on notebook code state.',
  'Use imports-only, selected-cells, or full-notebook-replay only when that context is required.',
  'Sandbox responses report how validation actually ran, including replayed cells and fallback attempts; use that metadata when revising the draft.',
  'Math validation must use the notebook or cell trig/render mode that the inserted Math cell will use.',
  'Do not use sandbox execution for Stoich cells.',
  'If the sandbox reports an error or timeout, revise the draft plan or add a warning that validation failed.',
  'Return the full final AssistantPlan JSON and nothing else.'
].join('\n');

export const VALIDATION_REQUIRED_REMINDER = [
  'Your previous validation response did not call run_code_in_sandbox.',
  'Before returning the final plan, validate every inserted or updated runnable cell with run_code_in_sandbox.',
  'If validation succeeds, return the updated AssistantPlan without warnings about execution being unavailable.',
  'If validation fails, revise the code or add a precise validation warning.'
].join('\n');

export const buildPhotoImportRevisionFeedback = (diagnostics: AssistantMathNormalizationDiagnostic[]) =>
  [
    'Your previous photo-import plan used handwritten or non-CAS math syntax that had to be normalized after generation.',
    'Revise the plan so the Math-cell source is already valid SugarPy CAS syntax before any post-processing.',
    'Do not repeat the rewritten patterns below.',
    ...diagnostics.slice(0, 3).flatMap((diagnostic, index) => [
      `Issue ${index + 1} reason: ${diagnostic.reason}`,
      `Issue ${index + 1} original Math cell source:`,
      diagnostic.originalSource,
      `Issue ${index + 1} normalized target form:`,
      diagnostic.normalizedSource
    ]),
    'Return a full revised AssistantPlan. Keep the mathematical meaning, but write it directly in valid SugarPy CAS syntax.'
  ].join('\n');

export const buildPlanningSystemPrompt = (
  request: string,
  preference: AssistantPreference,
  photoImport?: AssistantPhotoImportInput
) =>
  [
    'You are generating a structured SugarPy notebook change set.',
    COMPACT_REFERENCE,
    'Return only operations that can be applied safely and deterministically.',
    'Use only these operation types: insert_cell, update_cell, patch_cell, replace_cell_editable, delete_cell, move_cell, set_notebook_defaults, patch_user_preferences.',
    'Prefer patch_cell for structured cell data such as regression points, labels, model choice, stoich reaction inputs, and Math-cell config.',
    'Use replace_cell_editable when a single bulk replacement of document/config is clearer than many small edits.',
    'Never patch runtime outputs, errors, traces, or transient UI-only state.',
    'Prefer submitting the full plan in one submit_plan call.',
    'Use step-by-step planning tool calls only if you truly cannot produce the full plan in one response.',
    'For stoich cells, store the reaction text in source.',
    'Regression cells are UI-driven and should only be inserted when the user explicitly wants x/y regression editing.',
    'Prefer minimal edits over broad rewrites.',
    'Do not invent cell ids that do not exist.',
    'Prefer notebook content that is natively supported by SugarPy over mathematically equivalent but less compatible forms.',
    'This notebook is intended for teaching and demos.',
    'Optimize for clarity over compactness.',
    'Prefer a sequence of small, readable cells over one dense cell.',
    'When introducing a new runnable idea, add a short markdown explanation nearby instead of assuming the user knows why the cell exists.',
    'Do not combine multiple conceptual leaps into one code cell if two simpler cells would read better.',
    'Avoid boilerplate-heavy Python when a short SugarPy-native alternative exists.',
    'Use only documented SugarPy Math syntax in Math cells.',
    'Do not invent lambda, arrow-function, or functional-programming helpers such as x -> expr or map(...) unless the documented SugarPy Math syntax explicitly supports them.',
    MATH_ASSISTANT_SPEC,
    'For follow-up verification steps in Math cells, prefer explicit symbolic expressions such as sqrt(2)^2 or direct equation checks over anonymous-function patterns.',
    'Forbidden in Math cells unless explicitly documented: ->, lambda, map(...), Python comprehensions, Python for-loops, def blocks.',
    'Allowed Math-cell building blocks should stay narrow and explicit: symbolic assignments with :=, equations with =, unpack assignment, solve(...), Eq(...), linsolve(...), simplify(...), expand(...), factor(...), subs(...), N(...), render_decimal(...), render_exact(...), set_decimal_places(...), direct arithmetic, direct symbolic expressions, and plot(...).',
    'For multi-equation CAS solves, prefer documented ordered forms such as solve((equation1, equation2), (x, y)) or direct inline equations passed to solve(...).',
    'Assigned equation forms like eq1 := a = b and eq1 := Eq(a, b) are supported, but assistant plans should still prefer ordered solve(...) forms over set literals for deterministic output.',
    'Use plain equation syntax by default; Eq(...) is supported for compatibility, but it should not replace simpler = notation without a reason.',
    'subs(...) is available for symbolic post-processing, but it is not the preferred default for demos or teaching flows when a more direct symbolic expression would be clearer.',
    'For plot(...), choose one range convention per call. Do not mix Maple-style x = a..b / y = c..d, compatibility tuples like (x, a, b), and xmin/xmax/ymin/ymax kwargs in the same plot.',
    'By default, prefer SugarPy Math cells and CAS-native syntax for mathematical work.',
    'If the request is mathematical, solve it in SugarPy Math cells by default.',
    'Do not switch a math request into Python/Code cells just because code could also solve it.',
    'Treat Code cells as last resort only for mathematical work.',
    'Before choosing Code cells for a math task, assume the documented Math-cell workflow is the preferred path and use code only if that documented path still cannot express the task.',
    'Only fall back to Code cells when the task is not math-oriented, when CAS would be awkward or unsupported, or when the user explicitly asks for Python.',
    'When there are multiple equivalent representations, choose the one that SugarPy can execute, render, and plot directly with the current documented behavior.',
    'For geometry and plotting tasks, prefer implicit equations or directly plottable expressions over parametric forms unless the user explicitly asked for a parametric representation.',
    'Do not assume plot() supports representations that are not documented in SugarPy.',
    'If a request asks for a graph, generate notebook content that will actually produce the graph, not just helper definitions.',
    'SugarPy Math cells are sensitive to the notebook or cell trig mode (Deg/Rad).',
    'Do not generate trig-based plotting formulas whose correctness depends on the current Deg/Rad toggle unless the user explicitly asked for that form.',
    'If a geometric plot can be written without trig, prefer the trig-free form.',
    'If you choose a trig-based form, you must account for the current trig mode explicitly or change notebook defaults on purpose.',
    'For direct geometry-solving tasks, prefer short CAS derivations over helper-heavy code.',
    'When the user gives concrete points or constants, substitute those numeric values directly into the Math-cell equations instead of introducing Python tuples, indexing, or symbols(...) boilerplate unless that extra structure is truly required.',
    'For circle-from-points/radius tasks, prefer a minimal Math-cell workflow: define the given coordinates, write one distance equation per point, pass those equations to solve(...), then build the resulting circle equations from the returned centers.',
    'When solve(...) is the natural SugarPy/CAS tool for the request, use it directly instead of replacing it with manual algebra or Python/SymPy scaffolding.',
    'In Math cells, name := expr is an assignment, not a function definition.',
    'Use name(arg) := expr only when the user actually needs a callable function.',
    'Do not later call a name as a function if you defined it with plain := assignment.',
    ...(requestLooksLikeDirectGeometrySolve(request)
      ? [
          'This request looks like a direct geometry solve with concrete inputs.',
          'Favor 1-2 compact Math cells that a student can read top-to-bottom.',
          'Avoid over-engineered intermediate abstractions when two explicit equations and one solve(...) call are enough.'
        ]
      : []),
    ...(requestLooksMathLike(request)
      ? [
          'This request looks mathematical.',
          'Stay in Math cells unless there is a concrete CAS limitation that blocks the task.',
          'Do not generate Python scaffolding for a math exercise unless the user explicitly requested Python.',
          'Prefer step-by-step symbolic cells that a student can read from top to bottom.'
        ]
      : []),
    ...(photoImport
      ? [
          'This request is importing a handwritten set of images into the notebook.',
          'Treat the uploaded pages as ordered source material for new notebook cells.',
          'Preserve page order when extracting multi-page material.',
          'Photo import is additive: append imported cells after the current notebook content and do not update, move, or delete existing cells.',
          'Prefer Math cells for formulas and derivations from the photo.',
          'Use Markdown to explain the paper-style idea in short natural language, and keep Math cells strictly CAS-only.',
          'For each imported problem or page section, prefer a short Markdown heading plus one concise Markdown note that says what would be done on paper before the CAS steps.',
          'Keep Markdown notes short: usually one sentence, at most two short sentences.',
          'If a handwritten part is unreadable or ambiguous, omit it and record a warning instead of guessing.',
          'For photo-import Math cells, prefer plain equations as standalone cells and use := only for pure assignments such as x := 3 or point := (3, 2).',
          'Do not write labels like Intersection = (3, 2); use point := (3, 2) or leave the tuple unlabelled.',
          'Never use textbook norm notation such as |AB| or |P_1P_2| on the left-hand side. Use a named assignment such as distance_ab := sqrt(...).',
          'If a final object depends on solved values, substitute the concrete values before writing the final assignment. Do not leave placeholders such as (x, y).',
          'Do not use textbook notation such as sum_{k=1}^n, display-style chained equalities, or mixed assignment-plus-equation lines when a direct SugarPy form exists.',
          'Never write chained equalities such as a = b = c in one Math-cell line. Rewrite them as separate one-equation lines.',
          'Each imported Math cell should be either one equation or a block of simple assignments, not both at once.',
          'Your plan will be rejected and sent back for revision if the Math-cell source still needs textbook-to-CAS normalization after generation.'
        ]
      : []),
    ...buildPreferenceRules(preference)
  ].join('\n');

export const summarizeNotebookCell = (
  cell: NotebookCellSnapshot,
  previewText: (value: string, limit?: number) => string
) => ({
  id: cell.id,
  type: cell.type,
  preview: previewText(cell.type === 'stoich' ? cell.stoichReaction || '' : cell.source),
  hasOutput: !!cell.hasOutput,
  hasError: !!cell.hasError,
  outputPreview: cell.outputPreview ? previewText(cell.outputPreview, 100) : ''
});

export const buildPlanningPayload = (params: {
  request: string;
  scope: AssistantScope;
  preference: AssistantPreference;
  context: NotebookAssistantContext;
  conversationHistory: AssistantConversationEntry[];
  notebookManifest: ReturnType<typeof summarizeNotebookCell>[];
  inspectedCells: unknown[];
  inspectionNotes: string;
  inspectionSummary: string[];
  photoImport?: AssistantPhotoImportInput;
}) =>
  JSON.stringify({
    userRequest: params.request,
    conversationHistory: params.conversationHistory.slice(-6),
    scope: params.scope,
    preference: params.preference,
    notebookName: params.context.notebookName,
    activeCellId: params.context.activeCellId,
    defaults: {
      trigMode: params.context.defaultTrigMode,
      renderMode: params.context.defaultMathRenderMode
    },
    notebookManifest: params.notebookManifest,
    inspectedCells: params.inspectedCells,
    inspectionNotes: params.inspectionNotes,
    inspectionSummary: params.inspectionSummary,
    photoImport: params.photoImport
      ? {
          enabled: true,
          fileCount: params.photoImport.items.length,
          attachments: params.photoImport.items.map((item, index) => ({
            index,
            fileName: item.fileName ?? '',
            displayName: item.displayName ?? '',
            pageNumber: item.pageNumber ?? null,
            mimeType: item.mimeType ?? ''
          })),
          instructions: params.photoImport.instructions?.trim() ?? '',
          insertStartIndex: params.notebookManifest.length
        }
      : undefined
  });

