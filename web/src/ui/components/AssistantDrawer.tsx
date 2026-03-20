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
  items: Array<{
    id: string;
    kind: 'image' | 'pdf-page';
    fileName: string;
    displayName: string;
    mimeType: string;
    previewUrl: string;
    width: number;
    height: number;
    pageNumber?: number;
  }>;
  instructions: string;
};

export type AssistantDrawerSection = 'hub' | 'photo-import' | 'recent-chats' | 'settings';

type Props = {
  open: boolean;
  entryMode: 'photo-import' | 'chat';
  activeSection: AssistantDrawerSection;
  apiKey: string;
  hasDefaultApiKey: boolean;
  model: string;
  thinkingLevel: 'dynamic' | 'minimal' | 'low' | 'medium' | 'high';
  draft: string;
  loading: boolean;
  error: string;
  chats: AssistantChat[];
  activeChatId: string | null;
  photoImport: AssistantPhotoImportPreview | null;
  photoImportPreparing: boolean;
  onClose: () => void;
  onChangeSection: (section: AssistantDrawerSection) => void;
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
  onSelectPhotoFiles: (files: File[] | FileList | null | undefined) => void;
  onRemovePhotoItem: (id: string) => void;
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

const latestActivityLabel = (activity: AssistantActivity[]) => {
  const last = activity[activity.length - 1];
  if (!last) return '';
  return [last.label, last.detail].filter(Boolean).join(' · ');
};

export function AssistantDrawer({
  open,
  entryMode,
  activeSection,
  apiKey,
  hasDefaultApiKey,
  model,
  thinkingLevel,
  draft,
  loading,
  error,
  chats,
  activeChatId,
  photoImport,
  photoImportPreparing,
  onClose,
  onChangeSection,
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
  onSelectPhotoFiles,
  onRemovePhotoItem,
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
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = '0px';
    const nextHeight = Math.min(textareaRef.current.scrollHeight, 160);
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

  useEffect(() => {
    if (!open) return;
    if (entryMode !== 'chat') return;
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [entryMode, open]);

  const visibleMessages = useMemo(
    () => (activeChat?.messages ?? []).filter((message) => message.status !== 'dismissed'),
    [activeChat]
  );
  const photoImportItems = photoImport?.items ?? [];
  const hasPhotoItems = photoImportItems.length > 0;
  const hasPdfItems = photoImportItems.some((item) => item.kind === 'pdf-page');
  const isPhotoPanelOpen = activeSection === 'photo-import';
  const showPhotoSection = isPhotoPanelOpen || hasPhotoItems || photoImportPreparing;
  const showRecentChats = activeSection === 'recent-chats' && chats.length > 1;
  const showSettings = activeSection === 'settings';
  const photoSummaryText = photoImportPreparing
    ? 'Preparing previews…'
    : hasPhotoItems
      ? `${photoImportItems.length} queued ${photoImportItems.length === 1 ? 'item' : 'items'}`
      : 'No queued files';

  const handleDataTransfer = (files: FileList | null) => {
    onSelectPhotoFiles(files);
  };

  const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = (event) => {
    const clipboardFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (clipboardFiles.length === 0) return;
    event.preventDefault();
    onSelectPhotoFiles(clipboardFiles);
  };

  return (
    <aside className={`assistant-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="assistant-drawer-header compact">
        <div>
          <h2>Assistant</h2>
          <div className="assistant-header-note">Draft-first notebook edits. Nothing applies until you accept it.</div>
        </div>
        <div className="assistant-header-actions">
          <button className="assistant-icon-btn" type="button" onClick={onNewChat} aria-label="New chat" title="New chat">
            +
          </button>
          <button
            className={`assistant-icon-btn${showSettings ? ' active' : ''}`}
            type="button"
            onClick={() => onChangeSection(showSettings ? 'hub' : 'settings')}
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
        <div className="assistant-hub-card" data-testid="assistant-hub">
          <div className="assistant-hub-copy">
            <div className="assistant-op-title">Describe a change or add a photo</div>
            <div className="assistant-op-reason">
              Keep the main workflow compact. Photos, recent chats, and settings open only when needed.
            </div>
          </div>
          <div className="assistant-hub-actions">
            <button
              type="button"
              className={`button secondary compact${isPhotoPanelOpen ? ' is-active' : ''}`}
              data-testid="assistant-photo-toggle"
              onClick={() => onChangeSection(isPhotoPanelOpen ? 'hub' : 'photo-import')}
            >
              Add photo
            </button>
            {chats.length > 1 ? (
              <button
                type="button"
                className={`button secondary compact${showRecentChats ? ' is-active' : ''}`}
                data-testid="assistant-recent-toggle"
                onClick={() => onChangeSection(showRecentChats ? 'hub' : 'recent-chats')}
              >
                Recent chats
              </button>
            ) : null}
            <button
              type="button"
              className={`button ghost compact${showSettings ? ' is-active' : ''}`}
              data-testid="assistant-settings-panel-toggle"
              onClick={() => onChangeSection(showSettings ? 'hub' : 'settings')}
            >
              Settings
            </button>
          </div>
          {hasPhotoItems || photoImportPreparing ? (
            <button
              type="button"
              className="assistant-photo-summary"
              data-testid="assistant-photo-summary"
              onClick={() => onChangeSection(isPhotoPanelOpen ? 'hub' : 'photo-import')}
            >
              <span className="assistant-photo-summary-title">{photoSummaryText}</span>
              <span className="assistant-photo-summary-detail">
                {hasPdfItems ? 'PDF page order stays intact.' : 'Ready for one compact import run.'}
              </span>
            </button>
          ) : null}
        </div>

        {showSettings ? (
          <div className="assistant-settings-body">
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

        {showRecentChats ? (
          <div className="assistant-section-card" data-testid="assistant-recent-panel">
            <div className="assistant-section-card-header">
              <div>
                <div className="assistant-op-title">Recent chats</div>
                <div className="assistant-op-reason">Switch context only when you need to revisit an earlier draft.</div>
              </div>
              <button type="button" className="button ghost compact" onClick={() => onChangeSection('hub')}>
                Hide
              </button>
            </div>
            <div className="assistant-history-list">
              {chats.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  className={`assistant-history-chip${chat.id === activeChat?.id ? ' active' : ''}`}
                  onClick={() => {
                    onSelectChat(chat.id);
                    onChangeSection('hub');
                  }}
                >
                  {chat.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showPhotoSection ? (
          <div className="assistant-photo-import" data-testid="assistant-photo-import">
            <div className="assistant-photo-import-header">
              <div>
                <div className="assistant-op-title">Photo import</div>
                <div className="assistant-op-reason">
                  {hasPhotoItems
                    ? hasPdfItems
                      ? 'Queued PDF pages keep their original order.'
                      : 'Queued images will be read in the shown order.'
                    : 'Expand only when you want to upload or review files.'}
                </div>
              </div>
              <button
                type="button"
                className="button ghost compact"
                data-testid="assistant-photo-collapse"
                onClick={() => onChangeSection(isPhotoPanelOpen ? 'hub' : 'photo-import')}
              >
                {isPhotoPanelOpen ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {isPhotoPanelOpen ? (
              <>
                <div
                  className={`assistant-photo-dropzone compact${isDragActive ? ' is-drag-active' : ''}${photoImportPreparing ? ' is-preparing' : ''}`}
                  data-testid="assistant-photo-dropzone"
                  onPaste={handlePaste}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragActive(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!isDragActive) setIsDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    const nextTarget = event.relatedTarget;
                    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                      setIsDragActive(false);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragActive(false);
                    handleDataTransfer(event.dataTransfer.files);
                  }}
                >
                  <div className="assistant-photo-dropzone-title">
                    {photoImportPreparing ? 'Preparing pages…' : hasPhotoItems ? 'Add more images or PDFs' : 'Drop images or PDF here'}
                  </div>
                  <div className="assistant-op-reason">
                    Supports drag-and-drop, clipboard images, multiple images, and PDF page previews.
                  </div>
                  <div className="assistant-footer-actions">
                    <button
                      type="button"
                      className="button compact"
                      data-testid="assistant-import-photo"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={loading || photoImportPreparing}
                    >
                      {hasPhotoItems ? 'Choose more' : 'Choose files'}
                    </button>
                  </div>
                </div>

                {hasPhotoItems ? (
                  <>
                    <div className="assistant-photo-grid" data-testid="assistant-photo-grid">
                      {photoImportItems.map((item) => (
                        <div key={item.id} className="assistant-photo-card" data-testid="assistant-photo-preview">
                          <div className="assistant-photo-preview-wrap compact">
                            <img src={item.previewUrl} alt={item.displayName} className="assistant-photo-preview compact" />
                          </div>
                          <div className="assistant-photo-meta compact">
                            <strong>{item.displayName}</strong>
                            <span>{item.kind === 'pdf-page' && item.pageNumber ? `Page ${item.pageNumber}` : 'Image'}</span>
                          </div>
                          <div className="assistant-preview-actions compact">
                            <button
                              type="button"
                              className="button ghost compact"
                              data-testid="assistant-photo-remove"
                              onClick={() => onRemovePhotoItem(item.id)}
                              disabled={loading || photoImportPreparing}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <label className="assistant-field">
                      <span>Optional instruction</span>
                      <input
                        className="input"
                        data-testid="assistant-photo-instructions"
                        value={photoImport?.instructions ?? ''}
                        onChange={(event) => onChangePhotoInstructions(event.target.value)}
                        placeholder="For example: keep only the clean derivation"
                      />
                    </label>

                    <div className="assistant-preview-actions compact">
                      <button
                        type="button"
                        className="button compact"
                        data-testid="assistant-photo-extract"
                        onClick={onExtractPhoto}
                        disabled={loading || photoImportPreparing || !hasPhotoItems}
                      >
                        Extract draft
                      </button>
                      <button
                        type="button"
                        className="button ghost compact"
                        data-testid="assistant-photo-replace"
                        onClick={() => photoInputRef.current?.click()}
                        disabled={loading || photoImportPreparing}
                      >
                        Add more
                      </button>
                      <button
                        type="button"
                        className="button secondary compact"
                        data-testid="assistant-photo-clear"
                        onClick={onCancelPhotoImport}
                        disabled={loading || photoImportPreparing}
                      >
                        Clear all
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="file-input"
          data-testid="assistant-photo-input"
          onChange={(event) => {
            onSelectPhotoFiles(event.target.files);
            event.target.value = '';
          }}
        />

        <div className="assistant-chat-messages" ref={messageListRef}>
          {visibleMessages.length === 0 ? (
            <div className="assistant-empty-state">
              Ask for a notebook change in plain language. The assistant will build a staged draft and wait for acceptance before applying anything.
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

                  {step.errors.length > 0 ? (
                    <div className="assistant-warning">Acceptance is blocked for this step until the draft is revised.</div>
                  ) : null}

                  <details className="assistant-step-details">
                    <summary>Draft preview</summary>
                    {step.sourcePreview ? (
                      <pre className="assistant-op-source">
                        <code>{step.sourcePreview}</code>
                      </pre>
                    ) : (
                      <div className="assistant-op-reason">No new source in this step.</div>
                    )}
                  </details>

                  <details className="assistant-step-details">
                    <summary>Validation</summary>
                    {step.validations.length > 0 ? (
                      step.validations.map((validation, index) => (
                        <div
                          key={`${message.id}-validation-row-${step.id}-${index}`}
                          className="assistant-validation-detail"
                          data-testid="assistant-validation-detail"
                        >
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
                  </details>

                  <details className="assistant-step-details">
                    <summary>Planned change</summary>
                    <div className="assistant-op-list">
                      {step.changes.map((change, index) => (
                        <div key={`${message.id}-change-${step.id}-${index}`} className="assistant-op-reason">
                          {change}
                        </div>
                      ))}
                    </div>
                  </details>

                  <div className="assistant-preview-actions compact">
                    <button
                      type="button"
                      className="button secondary compact"
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
                      <div className="assistant-loading-status" data-testid="assistant-activity">
                        {latestActivityLabel(message.activity)}
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

                      {message.draftRun ? <div className="assistant-step-list">{stepCards}</div> : null}

                      <div className="assistant-preview-actions">
                        <button
                          data-testid="assistant-accept-all"
                          className="button compact"
                          onClick={() => onAcceptAll(message.id)}
                          disabled={loading || !message.draftRun || message.draftRun.hasFailures}
                        >
                          Accept all
                        </button>
                        <button
                          data-testid="assistant-reject-draft"
                          className="button secondary compact"
                          onClick={() => onReject(message.id)}
                          disabled={loading || !message.draftRun}
                        >
                          Reject draft
                        </button>
                        <button
                          data-testid="assistant-revise-draft"
                          className="button ghost compact"
                          onClick={() => onRevise(message.id)}
                          disabled={loading || !message.requestPrompt}
                        >
                          Revise
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
              <button type="button" className="button secondary compact assistant-send-btn assistant-icon-send" onClick={onStop}>
                ■
              </button>
            ) : (
              <button
                data-testid="assistant-generate"
                className="button compact assistant-send-btn assistant-icon-send"
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
