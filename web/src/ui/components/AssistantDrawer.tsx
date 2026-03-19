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

type AssistantPhotoImportPreview = {
  fileName: string;
  mimeType: string;
  previewUrl: string;
  width: number;
  height: number;
  instructions: string;
};

type Props = {
  open: boolean;
  entryMode: 'photo-import' | 'chat';
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
  photoImport: AssistantPhotoImportPreview | null;
  onClose: () => void;
  onOpenChat: () => void;
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
  onSelectPhoto: (file: File | null) => void;
  onChangePhotoInstructions: (value: string) => void;
  onExtractPhoto: () => void;
  onCancelPhotoImport: () => void;
};

const CUSTOM_MODEL_VALUE = '__custom__';

const getDraftStepStatus = (step: AssistantDraftRun['steps'][number]) => {
  if (step.errors.length > 0) return 'failed';
  if (step.validations.length > 0) return 'validated';
  return 'text-only';
};

const formatValidationStatusLabel = (status: ReturnType<typeof getDraftStepStatus>) => {
  if (status === 'failed') return 'Failed';
  if (status === 'validated') return 'Validated';
  return 'Text only';
};

export function AssistantDrawer({
  open,
  entryMode,
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
  photoImport,
  onClose,
  onOpenChat,
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
  onNewChat,
  onSelectPhoto,
  onChangePhotoInstructions,
  onExtractPhoto,
  onCancelPhotoImport
}: Props) {
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? chats[0] ?? null;
  const isPresetModel = ASSISTANT_MODEL_PRESETS.some((entry) => entry.value === model);
  const selectedModel = isPresetModel ? model : CUSTOM_MODEL_VALUE;
  const supportedThinkingLevels = useMemo(() => getSupportedThinkingLevels(model), [model]);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
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
  const showChatSection = entryMode === 'chat' || visibleMessages.length > 0 || draft.trim().length > 0;

  return (
    <aside className={`assistant-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="assistant-drawer-header">
        <div>
          <div className="assistant-kicker">Photo-first assistant</div>
          <h2>Import notebook edits from a photo</h2>
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

        <div className="assistant-photo-entry-card">
          <div>
            <div className="assistant-op-title">Import from photo</div>
            <div className="assistant-op-reason">
              Use a handwritten photo as the main entry flow. The assistant keeps the proposed draft visible even when validation fails.
            </div>
          </div>
          <div className="assistant-footer-actions">
            <button
              type="button"
              className="button"
              data-testid="assistant-import-photo"
              onClick={() => photoInputRef.current?.click()}
              disabled={loading}
            >
              Choose photo
            </button>
            {!showChatSection ? (
              <button
                type="button"
                className="button secondary"
                data-testid="assistant-open-chat"
                onClick={onOpenChat}
                disabled={loading}
              >
                Open typed assistant
              </button>
            ) : null}
          </div>
        </div>

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="file-input"
          data-testid="assistant-photo-input"
          onChange={(event) => {
            onSelectPhoto(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />

        {photoImport ? (
          <div className="assistant-photo-import" data-testid="assistant-photo-import">
            <div className="assistant-photo-preview-wrap">
              <img
                src={photoImport.previewUrl}
                alt={photoImport.fileName}
                className="assistant-photo-preview"
                data-testid="assistant-photo-preview"
              />
            </div>
            <div className="assistant-photo-meta">
              <strong>{photoImport.fileName}</strong>
              <span>{photoImport.width} × {photoImport.height} · {photoImport.mimeType}</span>
            </div>
            <label className="assistant-field">
              <span>Optional instruction</span>
              <input
                className="input"
                data-testid="assistant-photo-instructions"
                value={photoImport.instructions}
                onChange={(event) => onChangePhotoInstructions(event.target.value)}
                placeholder="For example: keep only the clean derivation"
              />
            </label>
            <div className="assistant-preview-actions">
              <button
                type="button"
                className="button"
                data-testid="assistant-photo-extract"
                onClick={onExtractPhoto}
                disabled={loading}
              >
                Extract draft
              </button>
              <button
                type="button"
                className="button secondary"
                data-testid="assistant-photo-cancel"
                onClick={onCancelPhotoImport}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button ghost"
                data-testid="assistant-photo-replace"
                onClick={() => photoInputRef.current?.click()}
                disabled={loading}
              >
                Replace photo
              </button>
            </div>
          </div>
        ) : null}

        {showChatSection ? (
          <div className="assistant-secondary-chat">
            <div className="assistant-secondary-chat-header">
              <div>
                <div className="assistant-op-title">Typed assistant</div>
                <div className="assistant-op-reason">Use this when you want to describe a notebook change without a photo.</div>
              </div>
              <button
                type="button"
                className="button ghost assistant-inline-chat-toggle"
                data-testid="assistant-open-chat"
                onClick={onOpenChat}
                disabled={loading}
              >
                Chat mode
              </button>
            </div>

            {chats.length > 0 ? (
              <div className="assistant-history-strip">
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    className={`assistant-history-chip${chat.id === activeChat?.id ? ' active' : ''}`}
                    onClick={() => onSelectChat(chat.id)}
                  >
                    {chat.title}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="assistant-chat-messages" ref={messageListRef}>
              {visibleMessages.length === 0 ? (
                <div className="assistant-empty-state">
                  Ask for a notebook change in plain language. The assistant will prepare a staged draft, validate it, and wait for acceptance before applying anything.
                </div>
              ) : null}

              {visibleMessages.map((message) => {
                const hasDraftFailures = !!message.draftRun?.hasFailures;
                const stepCards = (message.draftRun?.steps ?? []).map((step) => {
                  const stepStatus = getDraftStepStatus(step);
                  return (
                    <div key={`${message.id}-step-${step.id}`} className={`assistant-step-card status-${stepStatus}`} data-testid="assistant-step-card">
                      <div className="assistant-step-header">
                        <div>
                          <div className="assistant-op-title">{step.title}</div>
                          <div className="assistant-op-reason">{step.explanation}</div>
                        </div>
                        <span className={`assistant-step-badge status-${stepStatus}`} data-testid="assistant-step-status">
                          {formatValidationStatusLabel(stepStatus)}
                        </span>
                      </div>

                      <div className="assistant-step-section">
                        <div className="assistant-step-label">Proposed draft</div>
                        {step.sourcePreview ? (
                          <pre className="assistant-op-source">
                            <code>{step.sourcePreview}</code>
                          </pre>
                        ) : (
                          <div className="assistant-op-reason">No new source in this step.</div>
                        )}
                      </div>

                      <div className="assistant-step-section">
                        <div className="assistant-step-label">Validation</div>
                        {step.validations.length > 0 ? (
                          step.validations.map((validation, index) => (
                            <div key={`${message.id}-validation-row-${step.id}-${index}`} className="assistant-validation-detail">
                              <div className="assistant-op-reason">
                                Stage {index + 1}: {validation.summary.status} · {validation.summary.outputKind}
                              </div>
                              <div className="assistant-op-reason">Context: {validation.summary.contextSummary}</div>
                              <div className="assistant-op-reason">
                                Result: {validation.summary.outputPreview || 'No visible output.'}
                              </div>
                              {validation.summary.errorSummary ? (
                                <div className="assistant-error inline">{validation.summary.errorSummary}</div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <div className="assistant-op-reason">Text-only step. No sandbox validation was required.</div>
                        )}
                        {step.errors.length > 0 ? (
                          <div className="assistant-warning">Acceptance is blocked for this step until the draft is revised.</div>
                        ) : null}
                      </div>

                      <div className="assistant-step-section">
                        <div className="assistant-step-label">Planned change</div>
                        <div className="assistant-op-list">
                          {step.changes.map((change, index) => (
                            <div key={`${message.id}-change-${step.id}-${index}`} className="assistant-op-reason">
                              {change}
                            </div>
                          ))}
                        </div>
                      </div>

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
                  );
                });

                return (
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

                          {hasDraftFailures ? (
                            <div className="assistant-error" data-testid="assistant-draft-failure-banner">
                              Validation failed. The notebook was not changed. The draft below is the assistant proposal that failed validation.
                            </div>
                          ) : null}

                          {hasDraftFailures && message.draftRun ? <div className="assistant-step-list">{stepCards}</div> : null}

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

                          {!hasDraftFailures && message.draftRun ? <div className="assistant-step-list">{stepCards}</div> : null}

                          <div className="assistant-preview-actions">
                            <button
                              data-testid="assistant-accept-all"
                              className="button"
                              onClick={() => onAcceptAll(message.id)}
                              disabled={loading || !message.draftRun || message.draftRun.hasFailures}
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
                );
              })}
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
                  placeholder="Describe the notebook change you want."
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
        ) : null}
      </div>
    </aside>
  );
}
