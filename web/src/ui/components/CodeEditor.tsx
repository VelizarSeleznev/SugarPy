import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { acceptCompletion, autocompletion } from '@codemirror/autocomplete';

import { buildCompletionSource } from '../utils/completion';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  completions: { label: string; detail?: string }[];
  language?: any;
  placeholderText?: string;
};

export function CodeEditor({ value, onChange, onRun, completions, language, placeholderText }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const completionCompartment = useRef(new Compartment());
  const onRunRef = useRef(onRun);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

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
        keymap.of([
          {
            key: 'Enter',
            run: acceptCompletion
          },
          ...defaultKeymap,
          indentWithTab,
        ]),
        (language || python()),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: 'auto' },
          '.cm-scroller': { overflow: 'visible' }
        }),
        completionCompartment.current.of(
          autocompletion({
            override: [buildCompletionSource(completions)]
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
          override: [buildCompletionSource(completions)]
        })
      )
    });
  }, [completions]);

  return <div ref={containerRef} />;
}
