import type {
  AssistantActivity,
  AssistantCellKind,
  AssistantConversationEntry,
  AssistantDraftRun,
  AssistantNetworkEvent,
  AssistantPlan,
  AssistantResponseTrace,
  AssistantSandboxExecutionTrace,
  AssistantThinkingLevel,
  AssistantValidationSummary
} from '../utils/assistant';
import type { AssistantSandboxRequest } from '../utils/assistantSandbox';

export type AssistantChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'loading' | 'ready' | 'error' | 'stopped' | 'applied' | 'dismissed';
  activity?: AssistantActivity[];
  plan?: AssistantPlan | null;
  draftRun?: AssistantDraftRun | null;
  error?: string;
  requestPrompt?: string;
};

export type AssistantChatSession = {
  id: string;
  title: string;
  messages: AssistantChatMessage[];
  updatedAt: string;
};

export type AssistantRunTrace = {
  id: string;
  chatId: string;
  messageId: string;
  notebookId: string;
  notebookName: string;
  prompt: string;
  model: string;
  thinkingLevel: AssistantThinkingLevel;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'running' | 'completed' | 'error' | 'stopped';
  error?: string;
  context: {
    cellCount: number;
    activeCellId: string | null;
    defaults: {
      trigMode: 'deg' | 'rad';
      renderMode: 'exact' | 'decimal';
    };
  };
  conversationHistory: AssistantConversationEntry[];
  photoImport?: {
    instructions: string;
    items: Array<{
      index: number;
      fileName: string;
      displayName: string;
      pageNumber: number | null;
      mimeType: string;
    }>;
  };
  activity: AssistantActivity[];
  network: AssistantNetworkEvent[];
  responses: AssistantResponseTrace[];
  sandboxExecutions: AssistantSandboxExecutionTrace[];
  draftValidations: Array<{
    stepId: string;
    stepTitle: string;
    operationIndex: number;
    cellType: AssistantCellKind;
    request: AssistantSandboxRequest;
    summary: AssistantValidationSummary;
  }>;
  result?: {
    summary: string;
    warningCount: number;
    operationCount: number;
  };
};

export const previewAssistantLabel = (value: string, fallback: string) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  return compact.length <= 36 ? compact : `${compact.slice(0, 35)}…`;
};

export const createAssistantChat = (title = 'New chat'): AssistantChatSession => {
  const now = new Date().toISOString();
  return {
    id: `assistant-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages: [],
    updatedAt: now
  };
};

export const updateAssistantChats = (
  chats: AssistantChatSession[],
  chatId: string,
  updater: (chat: AssistantChatSession) => AssistantChatSession
) =>
  chats.map((chat) => {
    if (chat.id !== chatId) return chat;
    const next = updater(chat);
    return {
      ...next,
      updatedAt: new Date().toISOString()
    };
  });

export const updateAssistantMessages = (
  chats: AssistantChatSession[],
  chatId: string,
  messageId: string,
  updater: (message: AssistantChatMessage) => AssistantChatMessage
) =>
  updateAssistantChats(chats, chatId, (chat) => ({
    ...chat,
    messages: chat.messages.map((message) => (message.id === messageId ? updater(message) : message))
  }));

export const getActiveAssistantChat = (
  chats: AssistantChatSession[],
  activeChatId: string | null
) => chats.find((chat) => chat.id === activeChatId) ?? chats[0] ?? null;
