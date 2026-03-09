import React from 'react';

import {
  AssistantActivity,
  AssistantPreference,
  AssistantPlan,
  AssistantScope
} from '../utils/geminiAssistant';

type Props = {
  open: boolean;
  apiKey: string;
  model: string;
  scope: AssistantScope;
  preference: AssistantPreference;
  prompt: string;
  loading: boolean;
  error: string;
  status: string;
  activity: AssistantActivity[];
  plan: AssistantPlan | null;
  canUndo: boolean;
  onClose: () => void;
  onChangeApiKey: (value: string) => void;
  onChangeModel: (value: string) => void;
  onChangeScope: (value: AssistantScope) => void;
  onChangePreference: (value: AssistantPreference) => void;
  onChangePrompt: (value: string) => void;
  onGenerate: () => void;
  onApply: () => void;
  onApplyAndRun: () => void;
  onUndo: () => void;
};

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
      return `Update notebook defaults`;
    default:
      return operation.type;
  }
};

export function AssistantDrawer({
  open,
  apiKey,
  model,
  scope,
  preference,
  prompt,
  loading,
  error,
  status,
  activity,
  plan,
  canUndo,
  onClose,
  onChangeApiKey,
  onChangeModel,
  onChangeScope,
  onChangePreference,
  onChangePrompt,
  onGenerate,
  onApply,
  onApplyAndRun,
  onUndo
}: Props) {
  return (
    <aside className={`assistant-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="assistant-drawer-header">
        <div>
          <div className="assistant-kicker">Gemini Assistant</div>
          <h2>Notebook edits with preview</h2>
        </div>
        <button className="assistant-close-btn" onClick={onClose} aria-label="Close assistant">
          ×
        </button>
      </div>

      <div className="assistant-panel">
        <label className="assistant-field">
          <span>API key</span>
          <input
            data-testid="assistant-api-key"
            className="input"
            type="password"
            value={apiKey}
            onChange={(event) => onChangeApiKey(event.target.value)}
            placeholder="Paste Gemini API key"
          />
        </label>

        <label className="assistant-field">
          <span>Model</span>
          <input
            data-testid="assistant-model"
            className="input"
            value={model}
            onChange={(event) => onChangeModel(event.target.value)}
            placeholder="gemini-3.1-flash-lite-preview"
          />
        </label>

        <label className="assistant-field">
          <span>Scope</span>
          <select
            data-testid="assistant-scope"
            className="input"
            value={scope}
            onChange={(event) => onChangeScope(event.target.value as AssistantScope)}
          >
            <option value="active">Active cell</option>
            <option value="notebook">Whole notebook</option>
          </select>
        </label>

        <label className="assistant-field">
          <span>Preferred output</span>
          <select
            data-testid="assistant-preference"
            className="input"
            value={preference}
            onChange={(event) => onChangePreference(event.target.value as AssistantPreference)}
          >
            <option value="auto">Auto</option>
            <option value="cas">CAS-first</option>
            <option value="python">Python-first</option>
            <option value="explain">Explain-first</option>
          </select>
        </label>

        <label className="assistant-field">
          <span>Request</span>
          <textarea
            data-testid="assistant-prompt"
            className="assistant-textarea"
            value={prompt}
            onChange={(event) => onChangePrompt(event.target.value)}
            placeholder="Describe what should be added or changed."
          />
        </label>

        <div className="assistant-actions">
          <button
            data-testid="assistant-generate"
            className="button"
            onClick={onGenerate}
            disabled={loading}
          >
            {loading ? 'Thinking…' : 'Suggest Changes'}
          </button>
          <button
            data-testid="assistant-undo"
            className="button secondary"
            onClick={onUndo}
            disabled={!canUndo}
          >
            Undo Last AI Change
          </button>
        </div>

        {status ? <div className="assistant-status">{status}</div> : null}
        {error ? (
          <div className="assistant-error" data-testid="assistant-error">
            {error}
          </div>
        ) : null}

        {activity.length > 0 ? (
          <div className="assistant-activity" data-testid="assistant-activity">
            <div className="assistant-activity-title">Activity</div>
            <div className="assistant-activity-list">
              {activity.map((item, index) => (
                <div key={`activity-${index}`} className={`assistant-activity-item kind-${item.kind}`}>
                  <span className="assistant-activity-label">{item.label}</span>
                  {item.detail ? <span className="assistant-activity-detail">{item.detail}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {plan ? (
          <div className="assistant-preview" data-testid="assistant-preview">
            <div className="assistant-preview-header">
              <h3>Preview</h3>
              <div className="assistant-preview-actions">
                <button
                  data-testid="assistant-apply"
                  className="button secondary"
                  onClick={onApply}
                  disabled={loading}
                >
                  Apply
                </button>
                <button
                  data-testid="assistant-apply-run"
                  className="button"
                  onClick={onApplyAndRun}
                  disabled={loading}
                >
                  Apply and Run
                </button>
              </div>
            </div>

            <p className="assistant-summary">{plan.summary}</p>
            {plan.userMessage ? <p className="assistant-message">{plan.userMessage}</p> : null}

            {plan.warnings.length > 0 ? (
              <div className="assistant-warning-list">
                {plan.warnings.map((warning, index) => (
                  <div key={`warning-${index}`} className="assistant-warning">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="assistant-op-list">
              {plan.operations.length > 0 ? (
                plan.operations.map((operation, index) => (
                  <div key={`op-${index}`} className="assistant-op-item">
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
          </div>
        ) : null}
      </div>
    </aside>
  );
}
