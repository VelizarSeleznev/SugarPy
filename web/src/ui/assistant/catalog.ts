import type { AssistantProvider, AssistantThinkingLevel } from '../utils/assistant';

const SERVER_PROXY_KEY_PREFIX = 'server-proxy:';

export const DEFAULT_ASSISTANT_MODEL = 'gpt-5.4-mini';

export const ASSISTANT_MODEL_PRESETS = [
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
  { value: DEFAULT_ASSISTANT_MODEL, label: 'GPT-5 mini' },
  { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex mini' },
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5-nano', label: 'GPT-5 nano' },
  { value: 'moonshotai/kimi-k2-instruct-0905', label: 'Kimi K2 Instruct 0905 (Groq)' },
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' }
] as const;

export const ASSISTANT_THINKING_LEVELS = [
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
] as const;

const isServerProxyKey = (apiKey: string) => apiKey.trim().startsWith(SERVER_PROXY_KEY_PREFIX);

const getServerProxyProvider = (apiKey: string): AssistantProvider | null => {
  if (!isServerProxyKey(apiKey)) return null;
  const provider = apiKey.trim().slice(SERVER_PROXY_KEY_PREFIX.length);
  return provider === 'openai' || provider === 'gemini' || provider === 'groq' ? provider : null;
};

export const getSupportedThinkingLevels = (model: string): AssistantThinkingLevel[] => {
  const normalized = model.toLowerCase();
  if (normalized.startsWith('gpt-5.1-codex')) return ['dynamic', 'low', 'medium', 'high'];
  if (normalized.startsWith('gpt-5.1')) return ['dynamic', 'minimal', 'low', 'medium', 'high'];
  if (normalized.startsWith('gpt-5')) return ['dynamic', 'minimal', 'low', 'medium', 'high'];
  if (!normalized.includes('gemini-3')) return ['dynamic'];
  if (normalized.includes('pro')) return ['dynamic', 'low', 'high'];
  return ['dynamic', 'minimal', 'low', 'medium', 'high'];
};

export const normalizeThinkingLevel = (
  model: string,
  thinkingLevel: AssistantThinkingLevel
): AssistantThinkingLevel => {
  const supported = getSupportedThinkingLevels(model);
  return supported.includes(thinkingLevel) ? thinkingLevel : supported[0];
};

export const detectAssistantProvider = (model: string, apiKey = ''): AssistantProvider => {
  const proxyProvider = getServerProxyProvider(apiKey);
  if (proxyProvider) return proxyProvider;
  const normalized = model.toLowerCase();
  const trimmedKey = apiKey.trim();
  if (trimmedKey.startsWith('gsk_')) return 'groq';
  if (normalized.startsWith('gpt-') || normalized.startsWith('o') || normalized.includes('codex')) return 'openai';
  if (normalized.includes('kimi-k2') || normalized.startsWith('moonshotai/')) return 'groq';
  return 'gemini';
};
