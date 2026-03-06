import React from 'react';

type Props = {
  isActive: boolean;
  status: string;
  onRun?: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onActivate?: () => void;
  toolbarExtras?: React.ReactNode;
  children: React.ReactNode;
};

export function CellWrapper({
  isActive,
  status,
  onRun,
  onDelete,
  onMoveUp,
  onMoveDown,
  onActivate,
  toolbarExtras,
  children
}: Props) {
  const showStatus = !!onRun;
  return (
    <div
      className={`cell-wrapper${isActive ? ' is-active' : ''}`}
      data-testid="cell-wrapper"
      onClick={onActivate}
    >
      {showStatus ? (
        <div className="cell-status">
          <button
            type="button"
            data-testid="run-cell"
            className="cell-run-btn"
            onClick={(event) => {
              event.stopPropagation();
              onRun?.();
            }}
            title="Run (Shift+Enter)"
            aria-label="Run cell"
          >
            ▶
          </button>
          <span className="cell-status-label">[{status || ' '}]</span>
        </div>
      ) : null}
      <div className="cell-body">
        <div className="cell-toolbar" role="toolbar" aria-label="Cell actions">
          {toolbarExtras}
          <button type="button" className="cell-toolbar-btn" onClick={onMoveUp} aria-label="Move cell up">↑</button>
          <button type="button" className="cell-toolbar-btn" onClick={onMoveDown} aria-label="Move cell down">↓</button>
          <button type="button" className="cell-toolbar-btn danger" onClick={onDelete} aria-label="Delete cell">✕</button>
        </div>
        <div className="cell-content">{children}</div>
      </div>
    </div>
  );
}
