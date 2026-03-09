import React, { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  isActive: boolean;
  status: string;
  onRun?: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onActivate?: () => void;
  toolbarExtras?: React.ReactNode;
  showStatus?: boolean;
  inlineToolbar?: boolean;
  compactStatus?: boolean;
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
  showStatus = true,
  inlineToolbar = false,
  compactStatus = false,
  children
}: Props) {
  const swipeActions = useMemo(() => {
    const items: Array<{ label: string; className?: string; onClick: () => void }> = [];
    if (onRun) {
      items.push({ label: 'Run', className: 'primary', onClick: onRun });
    }
    items.push({ label: 'Up', onClick: onMoveUp });
    items.push({ label: 'Down', onClick: onMoveDown });
    items.push({ label: 'Delete', className: 'danger', onClick: onDelete });
    return items;
  }, [onDelete, onMoveDown, onMoveUp, onRun]);
  const actionWidth = swipeActions.length * 58;
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const suppressClickRef = useRef(false);
  const touchState = useRef({
    active: false,
    swiping: false,
    startX: 0,
    startY: 0,
    baseOffset: 0
  });

  useEffect(() => {
    setSwipeOffset(actionsOpen ? -actionWidth : 0);
  }, [actionWidth, actionsOpen]);

  const closeActions = () => {
    setActionsOpen(false);
    setSwipeOffset(0);
  };

  const clampOffset = (value: number) => Math.max(-actionWidth, Math.min(0, value));

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-block-cell-swipe="true"]')) {
      touchState.current.active = false;
      touchState.current.swiping = false;
      return;
    }
    const touch = event.touches[0];
    touchState.current = {
      active: true,
      swiping: false,
      startX: touch.clientX,
      startY: touch.clientY,
      baseOffset: actionsOpen ? -actionWidth : 0
    };
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!touchState.current.active || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - touchState.current.startX;
    const dy = touch.clientY - touchState.current.startY;

    if (!touchState.current.swiping) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) + 4) return;
      touchState.current.swiping = true;
    }

    event.preventDefault();
    setSwipeOffset(clampOffset(touchState.current.baseOffset + dx));
  };

  const handleTouchEnd = () => {
    if (!touchState.current.active) return;
    const shouldOpen = swipeOffset <= -actionWidth / 2;
    suppressClickRef.current = touchState.current.swiping;
    setActionsOpen(shouldOpen);
    setSwipeOffset(shouldOpen ? -actionWidth : 0);
    touchState.current.active = false;
    touchState.current.swiping = false;
  };

  const statusVisible = showStatus && !!onRun;
  return (
    <div className={`cell-shell${actionsOpen ? ' actions-open' : ''}`}>
      <div className="cell-swipe-actions" aria-hidden={!actionsOpen}>
        {swipeActions.map((item) => (
          <button
            key={`${item.label}-${item.className || 'default'}`}
            type="button"
            className={`cell-swipe-action-btn${item.className ? ` ${item.className}` : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              item.onClick();
              closeActions();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className={`cell-wrapper${isActive ? ' is-active' : ''}`}
        data-testid="cell-wrapper"
        style={{ transform: `translateX(${swipeOffset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (actionsOpen) {
            closeActions();
            return;
          }
          onActivate?.();
        }}
      >
        {statusVisible ? (
          <div className={`cell-status${compactStatus ? ' compact' : ''}`}>
            <button
              type="button"
              data-testid="run-cell"
              className={`cell-run-btn${compactStatus ? ' compact' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                closeActions();
                onRun?.();
              }}
              title="Run (Shift+Enter)"
              aria-label="Run cell"
            >
              {compactStatus ? '▶' : 'Run'}
            </button>
            {!compactStatus ? <span className="cell-status-label">[{status || ' '}]</span> : null}
          </div>
        ) : null}
        <div className="cell-body">
          <div className={`cell-toolbar${inlineToolbar ? ' inline' : ''}`} role="toolbar" aria-label="Cell actions">
            {inlineToolbar ? (
              <>
                <div className="cell-toolbar-group left">
                  {onRun ? (
                    <button
                      type="button"
                      className="cell-toolbar-btn run icon-only"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeActions();
                        onRun();
                      }}
                      aria-label="Run cell"
                      title="Run (Shift+Enter)"
                    >
                      ▶
                    </button>
                  ) : null}
                </div>
                <div className="cell-toolbar-group right">
                  {toolbarExtras}
                  <button type="button" className="cell-toolbar-btn" onClick={onMoveUp} aria-label="Move cell up">Up</button>
                  <button type="button" className="cell-toolbar-btn" onClick={onMoveDown} aria-label="Move cell down">Down</button>
                  <button type="button" className="cell-toolbar-btn danger" onClick={onDelete} aria-label="Delete cell">Delete</button>
                </div>
              </>
            ) : (
              <>
                {toolbarExtras}
                {onRun ? (
                  <button
                    type="button"
                    className="cell-toolbar-btn run"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeActions();
                      onRun();
                    }}
                    aria-label="Run cell"
                    title="Run (Shift+Enter)"
                  >
                    Run
                  </button>
                ) : null}
                <button type="button" className="cell-toolbar-btn" onClick={onMoveUp} aria-label="Move cell up">Up</button>
                <button type="button" className="cell-toolbar-btn" onClick={onMoveDown} aria-label="Move cell down">Down</button>
                <button type="button" className="cell-toolbar-btn danger" onClick={onDelete} aria-label="Delete cell">Delete</button>
              </>
            )}
          </div>
          <div className="cell-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
