import type { MutableRefObject } from 'react';

import { fetchRuntimeConfig, persistAssistantTraceToServer, type SugarPyRuntimeConfig } from '../utils/backendApi';
import type { AssistantRunTrace } from './session';

export type AssistantRuntimeConfig = {
  model?: string;
  providers?: {
    openai?: boolean;
    gemini?: boolean;
    groq?: boolean;
  };
};

export const hydrateAssistantRuntimeConfig = async (
  setRuntimeConfig: (value: SugarPyRuntimeConfig | null) => void
): Promise<AssistantRuntimeConfig | null> => {
  try {
    const parsed = await fetchRuntimeConfig();
    setRuntimeConfig(parsed);
    const runtimeModel = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    return {
      model: runtimeModel || undefined,
      providers: parsed.providers
    };
  } catch (_err) {
    return null;
  }
};

type PersistAssistantTraceOptions = {
  trace: AssistantRunTrace;
  storageKey: string;
  readOptionalStorageItem: (key: string) => string | null;
  writeStorageItem: (key: string, value: string) => void;
  pendingRef: MutableRefObject<Map<string, AssistantRunTrace>>;
  flushRef: MutableRefObject<Map<string, Promise<void>>>;
};

export const persistAssistantTrace = async ({
  trace,
  storageKey,
  readOptionalStorageItem,
  writeStorageItem,
  pendingRef,
  flushRef
}: PersistAssistantTraceOptions) => {
  try {
    const existingRaw = readOptionalStorageItem(storageKey);
    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    const next = Array.isArray(existing)
      ? [
          trace,
          ...existing.filter((entry: any) => entry && typeof entry === 'object' && entry.id !== trace.id)
        ].slice(0, 25)
      : [trace];
    writeStorageItem(storageKey, JSON.stringify(next));
  } catch (_err) {
    // Ignore local trace persistence failures.
  }

  pendingRef.current.set(trace.id, trace);
  if (flushRef.current.has(trace.id)) {
    return;
  }

  const flushTrace = async () => {
    while (pendingRef.current.has(trace.id)) {
      const nextTrace = pendingRef.current.get(trace.id);
      pendingRef.current.delete(trace.id);
      if (!nextTrace) continue;
      try {
        await persistAssistantTraceToServer(nextTrace as unknown as Record<string, unknown>);
      } catch (_err) {
        // Trace persistence must never block assistant execution.
      }
    }
  };

  const flushPromise = flushTrace().finally(() => {
    flushRef.current.delete(trace.id);
    const pendingTrace = pendingRef.current.get(trace.id);
    if (pendingTrace) {
      void persistAssistantTrace({
        trace: pendingTrace,
        storageKey,
        readOptionalStorageItem,
        writeStorageItem,
        pendingRef,
        flushRef
      });
    }
  });
  flushRef.current.set(trace.id, flushPromise);
  await flushPromise;
};
