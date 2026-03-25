import type { CellEditablePatch, CellKind } from '../cells/types';

export type AssistantPatchUserPreferences = {
  themeId?: string;
  density?: 'comfortable' | 'compact';
  fontScale?: number;
  panelVisibility?: Record<string, boolean>;
  assistantUi?: {
    compactDraftPreview?: boolean;
    compactTrace?: boolean;
    stagedDraftOpen?: boolean;
  };
  themeOverrides?: Record<string, string>;
  notebookPresentation?: {
    cellOutputCollapsedByDefault?: boolean;
    compactCells?: boolean;
    showInsertHints?: boolean;
  };
};

export type AssistantOperation =
  | {
      type: 'insert_cell';
      index: number;
      cellType: CellKind;
      source: string;
      document?: Record<string, unknown>;
      config?: Record<string, unknown>;
      reason?: string;
    }
  | {
      type: 'update_cell';
      cellId: string;
      source: string;
      reason?: string;
    }
  | {
      type: 'patch_cell';
      cellId: string;
      patch: CellEditablePatch;
      reason?: string;
    }
  | {
      type: 'replace_cell_editable';
      cellId: string;
      document: Record<string, unknown>;
      config?: Record<string, unknown>;
      reason?: string;
    }
  | {
      type: 'delete_cell';
      cellId: string;
      reason?: string;
    }
  | {
      type: 'move_cell';
      cellId: string;
      index: number;
      reason?: string;
    }
  | {
      type: 'set_notebook_defaults';
      trigMode?: 'deg' | 'rad';
      renderMode?: 'exact' | 'decimal';
      reason?: string;
    }
  | {
      type: 'patch_user_preferences';
      patch: AssistantPatchUserPreferences;
      reason?: string;
    };
