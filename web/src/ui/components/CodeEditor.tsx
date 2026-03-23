import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  snippetKeymap
} from '@codemirror/autocomplete';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

import { buildCompletionSource, buildSlashCompletionSource } from '../utils/completion';
import type { EditorCompletionItem } from '../utils/editorSymbols';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  completions: EditorCompletionItem[];
  slashCommands?: EditorCompletionItem[];
  onSlashCommand?: (command: string) => boolean;
  language?: any;
  placeholderText?: string;
  autoFocus?: boolean;
  shortcutItems?: { label: string; snippet: string }[];
  extractSymbols?: (source: string) => EditorCompletionItem[];
};

const CURSOR_MARKER = '__CURSOR__';

const editorHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: '#7c3aed', fontWeight: '700' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.special(tags.variableName)], color: '#0f62fe', fontWeight: '700' },
  { tag: [tags.variableName, tags.name], color: '#243244' },
  { tag: [tags.propertyName, tags.className, tags.typeName, tags.definition(tags.variableName)], color: '#0f766e', fontWeight: '600' },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.atom], color: '#b45309', fontWeight: '700' },
  { tag: [tags.string, tags.special(tags.string)], color: '#c2410c' },
  { tag: [tags.comment, tags.meta], color: '#8b95a7', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: '#c026d3', fontWeight: '600' },
  { tag: [tags.bracket, tags.squareBracket, tags.paren, tags.angleBracket], color: '#2563eb', fontWeight: '700' },
  { tag: tags.invalid, color: '#dc2626', backgroundColor: 'rgba(254, 226, 226, 0.95)', borderRadius: '4px' }
]);

export function CodeEditor({
  value,
  onChange,
  onRun,
  completions,
  slashCommands = [],
  onSlashCommand,
  language,
  placeholderText,
  autoFocus,
  shortcutItems = [],
  extractSymbols
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const completionCompartment = useRef(new Compartment());
  const onRunRef = useRef(onRun);
  const onSlashCommandRef = useRef(onSlashCommand);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  useEffect(() => {
    onSlashCommandRef.current = onSlashCommand;
  }, [onSlashCommand]);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (event.key === 'Enter' && event.shiftKey) {
              const doc = viewRef.current?.state.doc.toString() ?? '';
              onRunRef.current(doc);
              return true;
            }
            return false;
          }
        }),
        Prec.high(
          keymap.of([
            {
              key: 'Enter',
              run: (view) => {
                const accepted = acceptCompletion(view);
                const doc = view.state.doc.toString();
                const match = doc.trim().match(/^\/([A-Za-z0-9_]+)$/);
                if (match && onSlashCommandRef.current) {
                  if (onSlashCommandRef.current(match[1])) {
                    return true;
                  }
                }
                return accepted;
              }
            }
          ])
        ),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, indentWithTab]),
        keymap.of(snippetKeymap),
        (language || python()),
        syntaxHighlighting(editorHighlightStyle),
        closeBrackets(),
        bracketMatching(),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: 'auto' },
          '.cm-scroller': { overflow: 'visible' }
        }),
        completionCompartment.current.of(
          autocompletion({
            override: [
              ...(slashCommands.length > 0 ? [buildSlashCompletionSource(slashCommands)] : []),
              buildCompletionSource(completions, extractSymbols)
            ]
          })
        ),
        placeholder(placeholderText || ''),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        })
      ]
    });

    const view = new EditorView({
      state,
      parent: containerRef.current
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (autoFocus && viewRef.current) {
      viewRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value }
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: completionCompartment.current.reconfigure(
        autocompletion({
          override: [
            ...(slashCommands.length > 0 ? [buildSlashCompletionSource(slashCommands)] : []),
            buildCompletionSource(completions, extractSymbols)
          ]
        })
      )
    });
  }, [completions, slashCommands, extractSymbols]);

  const insertSnippet = (snippet: string) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const markerIndex = snippet.indexOf(CURSOR_MARKER);
    const insertText = markerIndex >= 0 ? snippet.replace(CURSOR_MARKER, '') : snippet;
    const cursorOffset = markerIndex >= 0 ? markerIndex : insertText.length;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: insertText },
      selection: { anchor: selection.from + cursorOffset }
    });
    view.focus();
  };

  return (
    <div className="editor-shell">
      <div ref={containerRef} />
      {shortcutItems.length > 0 ? (
        <div className="editor-shortcuts" role="toolbar" aria-label="Editor shortcuts">
          {shortcutItems.map((item) => (
            <button
              key={`${item.label}-${item.snippet}`}
              type="button"
              className="editor-shortcut-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertSnippet(item.snippet)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
