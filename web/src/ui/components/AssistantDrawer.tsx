import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  AssistantActivity,
  AssistantDraftRun,
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
  draftRun?: AssistantDraftRun | null;
  error?: string;
  requestPrompt?: string;
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
  settingsOpen: boolean;
  onClose: () => void;
  onToggleSettings: () => void;
  onChangeApiKey: (value: string) => void;
  onChangeModel: (value: string) => void;
  onChangeThinkingLevel: (value: 'dynamic' | 'minimal' | 'low' | 'medium' | 'high') => void;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAcceptAll: (messageId: string) => void;
  onAcceptStep: (messageId: string, stepId: string) => void;
  onReject: (messageId: string) => void;
  onRevise: (messageId: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
};

const CUSTOM_MODEL_VALUE = '__custom__';

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
  settingsOpen,
  onClose,
  onToggleSettings,
  onChangeApiKey,
  onChangeModel,
  onChangeThinkingLevel,
  onChangeDraft,
  onSend,
  onStop,
  onAcceptAll,
  onAcceptStep,
  onReject,
  onRevise,
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
          <button className="assistant-icon-btn" type="button" onClick={onNewChat} aria-label="New chat" title="New chat">
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
            <button type="button" className="assistant-settings-close" onClick={onToggleSettings} aria-label="Hide assistant settings">
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
                placeholder={hasDefaultApiKey ? 'Using shared key by default' : 'Paste OpenAI, Groq, or Gemini API key'}
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
                  onChangeThinkingLevel(event.target.value as 'dynamic' | 'minimal' | 'low' | 'medium' | 'high')
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
              Ask for a notebook change in plain language. The assistant will prepare a staged draft, validate it, and wait for acceptance before applying anything.
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
                        <div key={`${message.id}-activity-${index}`} className={`assistant-activity-item kind-${item.kind}`}>
                          <span className="assistant-activity-label">{item.label}</span>
                          {item.detail ? <span className="assistant-activity-detail">{item.detail}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <details className="assistant-activity-collapsed">
                      <summary>Technical details</summary>
                      <div className="assistant-inline-activity">
                        {message.activity.map((item, index) => (
                          <div key={`${message.id}-collapsed-activity-${index}`} className={`assistant-activity-item kind-${item.kind}`}>
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
                    {message.createdAt ? ` ${Math.max(0, Math.floor((timeTick - Date.parse(message.createdAt)) / 1000))}s` : ''}
                  </div>
                ) : null}

                {message.plan || message.draftRun ? (
                  <div className="assistant-preview" data-testid="assistant-preview">
                    <p className="assistant-summary">{message.plan?.summary ?? message.draftRun?.summary ?? ''}</p>

                    <div className="assistant-op-item">
                      <div className="assistant-op-title">Plan</div>
                      <div className="assistant-op-reason">{message.plan?.outline?.summary ?? message.plan?.summary ?? 'No plan summary.'}</div>
                      {(message.plan?.outline?.steps ?? []).map((step, index) => (
                        <div key={`${message.id}-outline-${index}`} className="assistant-warning">
                          {index + 1}. {step}
                        </div>
                      ))}
                    </div>

                    {message.plan?.warnings?.length ? (
                      <div className="assistant-warning-list">
                        {message.plan.warnings.map((warning, index) => (
                          <div key={`${message.id}-warning-${index}`} className="assistant-warning">
                            {warning}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {message.draftRun ? (
                      <>
                        <div className="assistant-op-item">
                          <div className="assistant-op-title">Draft</div>
                          <div className="assistant-op-list">
                            {message.draftRun.steps.map((step) => (
                              <div key={`${message.id}-draft-${step.id}`} className="assistant-op-item">
                                <div className="assistant-op-reason">{step.title}: {step.explanation}</div>
                                {step.sourcePreview ? (
                                  <pre className="assistant-op-source">
                                    <code>{step.sourcePreview}</code>
                                  </pre>
                                ) : (
                                  <div className="assistant-op-reason">No new source in this step.</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="assistant-op-item">
                          <div className="assistant-op-title">Validation</div>
                          <div className="assistant-op-list">
                            {message.draftRun.steps.map((step) => (
                              <div key={`${message.id}-validation-${step.id}`} className="assistant-op-item">
                                <div className="assistant-op-reason">
                                  {step.title}: {step.errors.length > 0 ? 'failed' : step.validations.length > 0 ? 'validated' : 'schema/content pass'}
                                </div>
                                {step.validations.length > 0 ? (
                                  step.validations.map((validation, index) => (
                                    <div key={`${message.id}-validation-row-${step.id}-${index}`} className="assistant-op-reason">
                                      {validation.summary.status} · {validation.summary.outputKind} · {validation.summary.outputPreview || 'No preview'}
                                      {validation.summary.errorSummary ? ` · ${validation.summary.errorSummary}` : ''}
                                    </div>
                                  ))
                                ) : (
                                  <div className="assistant-op-reason">Markdown-only step.</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="assistant-op-item">
                          <div className="assistant-op-title">Changes</div>
                          <div className="assistant-op-list">
                            {message.draftRun.steps.map((step) => (
                              <div key={`${message.id}-changes-${step.id}`} className="assistant-op-item">
                                <div className="assistant-op-reason">{step.title}</div>
                                {step.changes.map((change, index) => (
                                  <div key={`${message.id}-change-${step.id}-${index}`} className="assistant-op-title">
                                    {change}
                                  </div>
                                ))}
                                <div className="assistant-preview-actions">
                                  <button
                                    type="button"
                                    className="button secondary"
                                    onClick={() => onAcceptStep(message.id, step.id)}
                                    disabled={loading || step.errors.length > 0}
                                  >
                                    Accept step
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}

                    <div className="assistant-preview-actions">
                      <button
                        data-testid="assistant-accept-all"
                        className="button"
                        onClick={() => onAcceptAll(message.id)}
                        disabled={loading || !message.draftRun || message.draftRun.steps.every((step) => step.errors.length > 0)}
                      >
                        Accept all
                      </button>
                      <button
                        data-testid="assistant-reject-draft"
                        className="button secondary"
                        onClick={() => onReject(message.id)}
                        disabled={loading || !message.draftRun}
                      >
                        Reject draft
                      </button>
                      <button
                        data-testid="assistant-revise-draft"
                        className="button ghost"
                        onClick={() => onRevise(message.id)}
                        disabled={loading || !message.requestPrompt}
                      >
                        Revise
                      </button>
                      <button type="button" className="button ghost" onClick={() => textareaRef.current?.focus()}>
                        Continue chat
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {error && !visibleMessages.some((message) => message.error === error) ? <div className="assistant-error">{error}</div> : null}

        <div className="assistant-chat-footer">
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
              <button type="button" className="button secondary assistant-send-btn assistant-icon-send" onClick={onStop}>
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
