import React, { useEffect, useRef, useState } from 'react';

export type CellMenuAction = {
  label: string;
  icon?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type QuickAction = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

type Props = {
  cellType: string;
  isActive: boolean;
  status: string;
  onRun?: () => void;
  onActivate?: () => void;
  quickActions?: QuickAction[];
  menuActions?: CellMenuAction[];
  children: React.ReactNode;
};

export function CellWrapper({
  cellType,
  isActive,
  status,
  onRun,
  onActivate,
  quickActions = [],
  menuActions = [],
  children
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [floatingStyle, setFloatingStyle] = useState<React.CSSProperties | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const showActionBar = isActive || isHovered;
  const combinedMenuActions: CellMenuAction[] = [
    ...quickActions.map((action) => ({
      label: action.label,
      icon: typeof action.icon === 'string' ? action.icon : undefined,
      onSelect: action.onClick,
      disabled: action.disabled
    })),
    ...menuActions
  ].filter((action, index, items) => items.findIndex((entry) => entry.label === action.label) === index);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (isActive) return;
    setMenuOpen(false);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      setFloatingStyle(null);
      return;
    }

    const updateFloatingStyle = () => {
      const shell = shellRef.current;
      if (!shell) {
        setFloatingStyle(null);
        return;
      }
      const rect = shell.getBoundingClientRect();
      const header = document.querySelector('.app-header') as HTMLElement | null;
      const barOffset = 6;
      const stickyTop = header ? Math.ceil(header.getBoundingClientRect().bottom + barOffset) : 68;
      const actionHeight = 32;
      const cellStillVisible = rect.bottom > stickyTop + actionHeight && rect.top < window.innerHeight;
      const shouldFloat = rect.top + barOffset < stickyTop && cellStillVisible;
      if (!shouldFloat) {
        setFloatingStyle(null);
        return;
      }
      const viewportRightInset = Math.max(10, window.innerWidth - rect.right + 10);
      setFloatingStyle({
        position: 'fixed',
        top: `${stickyTop}px`,
        right: `${viewportRightInset}px`
      });
    };

    updateFloatingStyle();
    window.addEventListener('scroll', updateFloatingStyle, true);
    window.addEventListener('resize', updateFloatingStyle);
    return () => {
      window.removeEventListener('scroll', updateFloatingStyle, true);
      window.removeEventListener('resize', updateFloatingStyle);
    };
  }, [isActive]);

  return (
    <article
      ref={shellRef}
      className={`cell-shell cell-type-${cellType}${isActive ? ' is-active' : ''}`}
      data-testid="cell-wrapper"
      onClick={() => onActivate?.()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        if (!isActive) {
          setMenuOpen(false);
        }
      }}
    >
      <div className="cell-gutter">
        {onRun ? (
          <button
            type="button"
            data-testid="run-cell"
            className="cell-gutter-run"
            onClick={(event) => {
              event.stopPropagation();
              onRun();
            }}
            title="Run cell"
            aria-label="Run cell"
          >
            ▶
          </button>
        ) : (
          <span className="cell-gutter-spacer" aria-hidden="true" />
        )}
        <span className="cell-gutter-status" aria-label={status ? `Execution ${status}` : 'No execution count'}>
          {status || '·'}
        </span>
      </div>

      <div className="cell-main">
        {showActionBar ? (
          <div
            className={`cell-action-bar${isActive && floatingStyle ? ' floating' : ''}`}
            style={isActive ? floatingStyle ?? undefined : undefined}
            role="toolbar"
            aria-label="Cell actions"
          >
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="cell-icon-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick();
                }}
                disabled={action.disabled}
                title={action.label}
                aria-label={action.label}
              >
                {action.icon}
              </button>
            ))}
            <div className="cell-overflow-wrap" ref={menuRef}>
              <button
                type="button"
                className="cell-icon-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((prev) => !prev);
                }}
                title="More cell actions"
                aria-label="More cell actions"
                aria-expanded={menuOpen}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="cell-overflow-menu">
                  {combinedMenuActions.map((action) => (
                    <button
                      key={`${action.label}-${action.icon || 'text'}`}
                      type="button"
                      className={`cell-overflow-item${action.danger ? ' danger' : ''}`}
                      disabled={action.disabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        action.onSelect();
                        setMenuOpen(false);
                      }}
                    >
                      {action.icon ? <span className="cell-overflow-icon">{action.icon}</span> : null}
                      <span>{action.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="cell-content">{children}</div>
      </div>
    </article>
  );
}
