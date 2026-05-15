import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getModel, type Effort, type ModelId } from '@/lib/models';

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic | null {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

function getOpenAI(): OpenAI | null {
  if (_openai) return _openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}

export interface CompletionResult {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export class MissingApiKeyError extends Error {
  constructor(public provider: 'anthropic' | 'openai') {
    super(`${provider.toUpperCase()}_API_KEY is not set. Add it to .env.local and restart the dev server.`);
    this.name = 'MissingApiKeyError';
  }
}

export type { Effort };

export interface CompleteOptions {
  effort?: Effort;
  /** Thinking toggle. Provider semantics:
   *  - Anthropic: when false, suppress adaptive/extended thinking even on
   *    high/max effort — the model returns a direct answer.
   *  - OpenAI:    when false, pin reasoning_effort to 'minimal' so the
   *    model skips the internal reasoning pass entirely. */
  thinking?: boolean;
}

export async function complete(
  modelId: ModelId,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1500,
  opts: CompleteOptions = {},
): Promise<CompletionResult> {
  const m = getModel(modelId);
  const effort = opts.effort ?? 'medium';
  const thinkingEnabled = opts.thinking !== false;

  if (m.provider === 'anthropic') {
    const client = getAnthropic();
    if (!client) throw new MissingApiKeyError('anthropic');

    // Opus 4.7 uses adaptive thinking + output_config.effort. The legacy
    // `{type:'enabled', budget_tokens:N}` shape returns 400 on this model.
    // max_tokens applies to the visible response only; thinking budget is
    // managed internally by the model based on effort.
    const apiEffort: 'low' | 'medium' | 'high' | 'max' =
      effort === 'max' ? 'max' : effort === 'high' ? 'high' : effort === 'low' ? 'low' : 'medium';

    // Adaptive thinking is auto-enabled on high/max effort, but the user can
    // explicitly disable it (faster, slightly less reliable on tricky reviews).
    const useThinking = thinkingEnabled && (effort === 'high' || effort === 'max');

    // SDK 0.32 types pre-date these fields; cast through unknown to bypass.
    const params = {
      model: m.apiName,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      ...(useThinking ? { thinking: { type: 'adaptive' } } : {}),
      output_config: { effort: apiEffort },
    } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming;

    const resp = await client.messages.create(params);
    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();
    return {
      text,
      tokensIn: resp.usage.input_tokens,
      tokensOut: resp.usage.output_tokens,
    };
  }

  const client = getOpenAI();
  if (!client) throw new MissingApiKeyError('openai');

  // OpenAI reasoning models expose `reasoning_effort` ∈ {minimal, low, medium, high}.
  // 'max' on our side maps to 'high' on theirs (the highest available tier).
  // Thinking toggle is implemented by pinning to 'minimal' — that's the
  // OpenAI knob for "skip the internal reasoning pass and answer fast".
  const reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' = !thinkingEnabled
    ? 'minimal'
    : effort === 'max' || effort === 'high'
      ? 'high'
      : effort === 'low'
        ? 'low'
        : 'medium';

  // SDK type for `reasoning_effort` doesn't include 'minimal' yet; cast.
  const resp = await client.chat.completions.create({
    model: m.apiName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
    reasoning_effort: reasoningEffort as 'low' | 'medium' | 'high',
  });
  const text = resp.choices[0]?.message?.content?.trim() ?? '';
  return {
    text,
    tokensIn: resp.usage?.prompt_tokens,
    tokensOut: resp.usage?.completion_tokens,
  };
}
