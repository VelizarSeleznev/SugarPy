import React, { useMemo, useState } from 'react';
import katex from 'katex';
import { reactionToLatex } from '../utils/reactionFormat';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

const renderReactionPreview = (text: string, placeholder = '') => {
  const display = text || placeholder;
  if (!display) return null;
  const latex = reactionToLatex(display);
  try {
    const html = katex.renderToString(latex, { throwOnError: false, displayMode: false });
    const className = text ? undefined : 'reaction-input__placeholder';
    return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch (_err) {
    return text ? <span>{display}</span> : <span className="reaction-input__placeholder">{display}</span>;
  }
};

export function ReactionInput({
  value,
  onChange,
  placeholder,
  onBlur,
  onKeyDown,
  onFocus,
  className,
  disabled,
  ariaLabel
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const preview = useMemo(() => renderReactionPreview(value, placeholder), [value, placeholder]);
  return (
    <div className={`reaction-input ${isEditing ? 'is-editing' : ''} ${className || ''}`.trim()}>
      <div className="reaction-input__preview" aria-hidden="true">
        {preview}
      </div>
      <input
        className="input reaction-input__text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          setIsEditing(false);
          onBlur?.(e);
        }}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          setIsEditing(true);
          onFocus?.(e);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder || 'Reaction'}
        disabled={disabled}
      />
    </div>
  );
}
