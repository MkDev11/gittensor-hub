export type ModelId = string;
export type Effort = 'low' | 'medium' | 'high' | 'max';

export interface ModelInfo {
  id: ModelId;
  label: string;
  provider: 'anthropic' | 'openai';
  apiName: string;
  badge: string;
  /** Effort tiers this model actually supports. Anthropic Opus 4.7 is the
   *  only model with the dedicated 'max' adaptive-thinking tier; everything
   *  else tops out at 'high'. The UI hides options outside this list and
   *  clamps the currently-selected effort when the user switches models. */
  supportedEfforts: Effort[];
  /** All listed models support some form of thinking — the toggle's
   *  meaning differs by provider:
   *  - Anthropic: enables adaptive / extended thinking on high+ effort.
   *  - OpenAI:    reasoning_effort follows the user's effort. When OFF we
   *               pin reasoning_effort to 'minimal' so the model returns
   *               quickly without an internal reasoning pass. */
  supportsThinking: true;
}

const ANTHROPIC_TOP_EFFORTS: Effort[] = ['low', 'medium', 'high', 'max'];
const STANDARD_EFFORTS: Effort[] = ['low', 'medium', 'high'];

export const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    provider: 'anthropic',
    apiName: 'claude-opus-4-6',
    badge: 'Anthropic',
    supportedEfforts: STANDARD_EFFORTS,
    supportsThinking: true,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    apiName: 'claude-sonnet-4-6',
    badge: 'Anthropic',
    supportedEfforts: STANDARD_EFFORTS,
    supportsThinking: true,
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    provider: 'anthropic',
    apiName: 'claude-opus-4-7',
    badge: 'Anthropic',
    supportedEfforts: ANTHROPIC_TOP_EFFORTS,
    supportsThinking: true,
  },
  {
    id: 'gpt-5',
    label: 'GPT-5.5',
    provider: 'openai',
    apiName: 'gpt-5',
    badge: 'OpenAI',
    supportedEfforts: STANDARD_EFFORTS,
    supportsThinking: true,
  },
  {
    id: 'gpt-5-4',
    label: 'GPT-5.4',
    provider: 'openai',
    apiName: 'gpt-5-4',
    badge: 'OpenAI',
    supportedEfforts: STANDARD_EFFORTS,
    supportsThinking: true,
  },
  {
    id: 'gpt-5-codex',
    label: 'GPT-5.3 Codex',
    provider: 'openai',
    apiName: 'gpt-5-codex',
    badge: 'OpenAI',
    supportedEfforts: STANDARD_EFFORTS,
    supportsThinking: true,
  },
];

export const MODELS = FALLBACK_MODELS;

export function getModel(id: ModelId, available: ModelInfo[] = FALLBACK_MODELS): ModelInfo {
  const m = available.find((x) => x.id === id) ?? FALLBACK_MODELS.find((x) => x.id === id);
  if (m) return m;
  const isOpenAI = id.startsWith('gpt');
  return {
    id,
    label: id,
    provider: isOpenAI ? 'openai' : 'anthropic',
    apiName: id,
    badge: isOpenAI ? 'OpenAI' : 'Anthropic',
    supportedEfforts: STANDARD_EFFORTS,
    supportsThinking: true,
  };
}

/** Clamp `effort` to whatever the model actually supports. Used when the
 *  user had 'max' selected and switched to a model that doesn't expose it —
 *  we silently fall back to the highest available tier instead of forcing a
 *  non-functional default. */
export function clampEffort(effort: Effort, model: ModelInfo): Effort {
  if (model.supportedEfforts.includes(effort)) return effort;
  // Fall back to the model's highest supported tier.
  const highest = model.supportedEfforts[model.supportedEfforts.length - 1];
  return highest ?? 'medium';
}

export function isValidModelId(id: string): id is ModelId {
  return typeof id === 'string' && id.length > 0;
}
