import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  AssistantActivity,
  ASSISTANT_MODEL_PRESETS,
  ASSISTANT_THINKING_LEVELS,
  getSupportedThinkingLevels,
  AssistantPlan
} from '../utils/assistant';

type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  status?: 'loading' | 'ready' | 'error' | 'stopped' | 'applied' | 'dismissed';
  activity?: AssistantActivity[];
  plan?: AssistantPlan | null;
  error?: string;
};

type AssistantChat = {
  id: string;
  title: string;
  messages: AssistantMessage[];
};

type Props = {
  open: boolean;
  apiKey: string;
  hasDefaultApiKey: boolean;
  model: string;
  thinkingLevel: 'dynamic' | 'minimal' | 'low' | 'medium' | 'high';
  draft: string;
  loading: boolean;
  error: string;
  chats: AssistantChat[];
  activeChatId: string | null;
  canUndo: boolean;
  settingsOpen: boolean;
  onClose: () => void;
  onToggleSettings: () => void;
  onChangeApiKey: (value: string) => void;
  onChangeModel: (value: string) => void;
  onChangeThinkingLevel: (value: 'dynamic' | 'minimal' | 'low' | 'medium' | 'high') => void;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onApply: (messageId: string) => void;
  onApplyAndRun: (messageId: string) => void;
  onDismiss: (messageId: string) => void;
  onUndo: () => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
};

const CUSTOM_MODEL_VALUE = '__custom__';

const describeOperation = (operation: AssistantPlan['operations'][number]) => {
  switch (operation.type) {
    case 'insert_cell':
      return `Insert ${operation.cellType} cell at ${operation.index + 1}`;
    case 'update_cell':
      return `Update cell ${operation.cellId}`;
    case 'delete_cell':
      return `Delete cell ${operation.cellId}`;
    case 'move_cell':
      return `Move cell ${operation.cellId} to ${operation.index + 1}`;
    case 'set_notebook_defaults':
      return 'Update notebook defaults';
    default:
      return operation.type;
  }
};

export function AssistantDrawer({
  open,
  apiKey,
  hasDefaultApiKey,
  model,
  thinkingLevel,
  draft,
  loading,
  error,
  chats,
  activeChatId,
  canUndo,
  settingsOpen,
  onClose,
  onToggleSettings,
  onChangeApiKey,
  onChangeModel,
  onChangeThinkingLevel,
  onChangeDraft,
  onSend,
  onStop,
  onApply,
  onApplyAndRun,
  onDismiss,
  onUndo,
  onSelectChat,
  onNewChat
}: Props) {
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? chats[0] ?? null;
  const isPresetModel = ASSISTANT_MODEL_PRESETS.some((entry) => entry.value === model);
  const selectedModel = isPresetModel ? model : CUSTOM_MODEL_VALUE;
  const supportedThinkingLevels = useMemo(() => getSupportedThinkingLevels(model), [model]);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [timeTick, setTimeTick] = useState(Date.now());

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = '0px';
    const nextHeight = Math.min(textareaRef.current.scrollHeight, 180);
    textareaRef.current.style.height = `${Math.max(44, nextHeight)}px`;
  }, [draft]);

  useEffect(() => {
    if (!messageListRef.current) return;
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [activeChat, loading]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setTimeTick(Date.now());
    }, 500);
    return () => window.clearInterval(id);
  }, [loading]);

  const visibleMessages = useMemo(
    () => (activeChat?.messages ?? []).filter((message) => message.status !== 'dismissed'),
    [activeChat]
  );
  return (
    <aside className={`assistant-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="assistant-drawer-header">
        <div>
          <div className="assistant-kicker">AI Assistant</div>
          <h2>Chat-driven notebook edits</h2>
        </div>
        <div className="assistant-header-actions">
          <button
            className="assistant-icon-btn"
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            title="New chat"
          >
            +
          </button>
          <button
            className={`assistant-icon-btn${settingsOpen ? ' active' : ''}`}
            type="button"
            onClick={onToggleSettings}
            aria-label="Assistant settings"
            title="Settings"
            data-testid="assistant-settings-toggle"
          >
            ⚙
          </button>
          <button className="assistant-close-btn" onClick={onClose} aria-label="Close assistant">
            ×
          </button>
        </div>
      </div>

      <div className="assistant-panel assistant-chat-panel">
        {settingsOpen ? (
          <div className="assistant-settings-body">
            <button
              type="button"
              className="assistant-settings-close"
              onClick={onToggleSettings}
              aria-label="Hide assistant settings"
            >
              Hide settings
            </button>
            <label className="assistant-field">
              <span>API key override</span>
              <input
                data-testid="assistant-api-key"
                className="input"
                type="password"
                value={apiKey}
                onChange={(event) => onChangeApiKey(event.target.value)}
                placeholder={hasDefaultApiKey ? 'Using shared key by default' : 'Paste OpenAI or Gemini API key'}
              />
              {hasDefaultApiKey ? <small>Shared server key is active unless you enter your own key here.</small> : null}
            </label>

            <label className="assistant-field">
              <span>Model</span>
              <select
                data-testid="assistant-model"
                className="input"
                value={selectedModel}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === CUSTOM_MODEL_VALUE) {
                    if (isPresetModel) onChangeModel('');
                    return;
                  }
                  onChangeModel(value);
                }}
              >
                {ASSISTANT_MODEL_PRESETS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
                <option value={CUSTOM_MODEL_VALUE}>Custom model</option>
              </select>
            </label>

            {!isPresetModel ? (
              <label className="assistant-field">
                <span>Custom model id</span>
                <input
                  data-testid="assistant-model-custom"
                  className="input"
                  value={model}
                  onChange={(event) => onChangeModel(event.target.value)}
                  placeholder={ASSISTANT_MODEL_PRESETS[0].value}
                />
              </label>
            ) : null}

            <label className="assistant-field">
              <span>Thinking level</span>
              <select
                data-testid="assistant-thinking-level"
                className="input"
                value={thinkingLevel}
                onChange={(event) =>
                onChangeThinkingLevel(
                  event.target.value as 'dynamic' | 'minimal' | 'low' | 'medium' | 'high'
                )
                }
              >
                {ASSISTANT_THINKING_LEVELS.filter((entry) => supportedThinkingLevels.includes(entry.value)).map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="assistant-chat-messages" ref={messageListRef}>
          {visibleMessages.length === 0 ? (
            <div className="assistant-empty-state">
              Ask for a notebook change in plain language. The assistant will reply with a reversible preview.
            </div>
          ) : null}

          {visibleMessages.map((message) => (
            <div
              key={message.id}
              className={`assistant-message assistant-message-${message.role}`}
              data-testid={message.role === 'user' ? 'assistant-user-message' : 'assistant-message'}
            >
              <div className="assistant-message-bubble">
                {message.content ? <p className="assistant-message-text">{message.content}</p> : null}
                {message.error ? (
                  <div className="assistant-error inline" data-testid="assistant-error">
                    {message.error}
                  </div>
                ) : null}

                {message.activity?.length ? (
                  message.status === 'loading' ? (
                    <div className="assistant-inline-activity" data-testid="assistant-activity">
                      {message.activity.map((item, index) => (
                        <div
                          key={`${message.id}-activity-${index}`}
                          className={`assistant-activity-item kind-${item.kind}`}
                        >
                          <span className="assistant-activity-label">{item.label}</span>
                          {item.detail ? <span className="assistant-activity-detail">{item.detail}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <details className="assistant-activity-collapsed">
                      <summary>Show steps</summary>
                      <div className="assistant-inline-activity">
                        {message.activity.map((item, index) => (
                          <div
                            key={`${message.id}-collapsed-activity-${index}`}
                            className={`assistant-activity-item kind-${item.kind}`}
                          >
                            <span className="assistant-activity-label">{item.label}</span>
                            {item.detail ? <span className="assistant-activity-detail">{item.detail}</span> : null}
                          </div>
                        ))}
                      </div>
                    </details>
                  )
                ) : null}

                {message.status === 'loading' ? (
                  <div className="assistant-loading-line">
                    Thinking{'.'.repeat(Math.floor(timeTick / 500) % 3 + 1)}
                    {message.createdAt
                      ? ` ${Math.max(0, Math.floor((timeTick - Date.parse(message.createdAt)) / 1000))}s`
                      : ''}
                  </div>
                ) : null}

                {message.plan ? (
                  <div className="assistant-preview" data-testid="assistant-preview">
                    <p className="assistant-summary">{message.plan.summary}</p>
                    {message.plan.warnings.length > 0 ? (
                      <div className="assistant-warning-list">
                        {message.plan.warnings.map((warning, index) => (
                          <div key={`${message.id}-warning-${index}`} className="assistant-warning">
                            {warning}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="assistant-op-list">
                      {message.plan.operations.length > 0 ? (
                        message.plan.operations.map((operation, index) => (
                          <div key={`${message.id}-op-${index}`} className="assistant-op-item">
                            <div className="assistant-op-title">{describeOperation(operation)}</div>
                            {operation.reason ? <div className="assistant-op-reason">{operation.reason}</div> : null}
                            {'source' in operation && operation.source ? (
                              <pre className="assistant-op-source">
                                <code>{operation.source}</code>
                              </pre>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div className="assistant-op-empty">No notebook changes proposed.</div>
                      )}
                    </div>

                    <div className="assistant-preview-actions">
                      <button
                        data-testid="assistant-apply"
                        className="button secondary"
                        onClick={() => onApply(message.id)}
                        disabled={loading || message.status === 'applied'}
                      >
                        {message.status === 'applied' ? 'Applied' : 'Apply'}
                      </button>
                      <button
                        data-testid="assistant-apply-run"
                        className="button"
                        onClick={() => onApplyAndRun(message.id)}
                        disabled={loading || message.status === 'applied'}
                      >
                        Apply and Run
                      </button>
                      <button
                        className="button ghost"
                        onClick={() => onDismiss(message.id)}
                        disabled={loading || message.status === 'applied'}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {error && !visibleMessages.some((message) => message.error === error) ? (
          <div className="assistant-error">{error}</div>
        ) : null}

        <div className="assistant-chat-footer">
          {canUndo ? (
            <div className="assistant-footer-actions">
              <button
                type="button"
                className="button secondary"
                onClick={onUndo}
                disabled={loading}
              >
                Undo
              </button>
            </div>
          ) : null}

          <div className="assistant-compose">
            <textarea
              ref={textareaRef}
              data-testid="assistant-prompt"
              className="assistant-chat-input"
              value={draft}
              onChange={(event) => onChangeDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (!loading && draft.trim()) {
                    onSend();
                  }
                }
              }}
              placeholder="Message"
            />
            {loading ? (
              <button
                type="button"
                className="button secondary assistant-send-btn assistant-icon-send"
                onClick={onStop}
              >
                ■
              </button>
            ) : (
              <button
                data-testid="assistant-generate"
                className="button assistant-send-btn assistant-icon-send"
                onClick={onSend}
                disabled={!draft.trim()}
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
