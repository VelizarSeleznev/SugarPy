export type OnboardingSeedCell = {
  type: 'markdown' | 'math';
  source: string;
};

export const ONBOARDING_SEEN_KEY = 'sugarpy:onboarding:seen:v1';
export const ONBOARDING_TUTORIAL_NOTEBOOK_ID_KEY = 'sugarpy:onboarding:tutorial-notebook-id:v1';
export const ONBOARDING_COACHMARKS_DISMISSED_KEY = 'sugarpy:onboarding:coachmarks-dismissed:v1';

export const FIRST_RUN_NOTEBOOK_NAME = 'SugarPy Quick Start';

const FIRST_RUN_NOTEBOOK_CELLS: OnboardingSeedCell[] = [
  {
    type: 'markdown',
    source: `# SugarPy Quick Start

SugarPy is built around notebook blocks, but for most classroom math you should start with **Math** cells, not Python.

## First controls to know

- Use the header **+** button or the left-rail **+** to add a new block.
- Run the current Code or Math cell with **Shift+Enter** or the run button.
- Create a fresh blank notebook from **⋮ > New Notebook**.
- Reorder blocks by dragging the left handle. On mobile, **long press** a cell shell and then drag.

Math cells use CAS-style input, keep the written form readable, and show a rendered card after you run them.`
  },
  {
    type: 'math',
    source: 'expand((x - 1)(x + 2))'
  },
  {
    type: 'markdown',
    source: `## Natural CAS rules

- Use \`=\` for equations.
- Use \`:=\` for assignment.
- Use \`^\` for powers.
- Implicit multiplication works, for example \`2x\` and \`(x+1)(x-1)\`.`
  },
  {
    type: 'math',
    source: 'eq := x^2 = 2\nsolutions := solve(eq, x)\nsolutions'
  },
  {
    type: 'markdown',
    source: `## Rendered Math cards

After a Math cell runs, SugarPy collapses it into a rendered card. Click the card to reopen the raw CAS input and edit it again.

The toolbar also lets you switch **Exact / Decimal** and **Degrees / Radians** without leaving the notebook flow.`
  },
  {
    type: 'math',
    source: "plot(x^2 - 4, x = -4..4, title='Parabola')"
  },
  {
    type: 'markdown',
    source: `## Next actions

- Use the header **+** button or the left rail **+** to add a new block.
- Drag the left handle to reorder cells. On mobile, long press a cell first and then drag.
- Use **Shift+Enter** whenever you want to run the current Code or Math cell quickly.
- Use **⋮ > New Notebook** when you want to start over with a blank notebook.
- Stay in Math cells when the task is symbolic, equation-based, or graph-first.
- Open the full quick reference here: [SugarPy CAS Wiki](/wiki).`
  }
];

const readStorageItem = (key: string) => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
};

const writeStorageItem = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch (_err) {
    // Ignore storage failures so onboarding never blocks notebook usage.
  }
};

export const hasSeenOnboarding = () => readStorageItem(ONBOARDING_SEEN_KEY) === '1';

export const markOnboardingSeen = () => {
  writeStorageItem(ONBOARDING_SEEN_KEY, '1');
};

export const loadTutorialNotebookId = () => readStorageItem(ONBOARDING_TUTORIAL_NOTEBOOK_ID_KEY);

export const saveTutorialNotebookId = (id: string) => {
  writeStorageItem(ONBOARDING_TUTORIAL_NOTEBOOK_ID_KEY, id);
};

export const loadCoachmarksDismissed = () =>
  readStorageItem(ONBOARDING_COACHMARKS_DISMISSED_KEY) === '1';

export const saveCoachmarksDismissed = () => {
  writeStorageItem(ONBOARDING_COACHMARKS_DISMISSED_KEY, '1');
};

export const getFirstRunNotebookCells = () => FIRST_RUN_NOTEBOOK_CELLS.map((cell) => ({ ...cell }));
