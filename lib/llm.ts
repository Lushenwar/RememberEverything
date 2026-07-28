// Server-only Anthropic access. Every caller must tolerate a null result:
// with no ANTHROPIC_API_KEY the engine falls back to deterministic heuristics,
// which is also what keeps the test suite runnable offline.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5';

let client: Anthropic | null = null;

export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic | null {
  if (!llmAvailable()) return null;
  client ??= new Anthropic();
  return client;
}

/** JSON Schema subset accepted by structured outputs (no min/max constraints). */
export type JsonSchema = Record<string, unknown>;

/**
 * One structured call. Returns null when no key is configured or the model
 * declined — never throws for those, so callers stay on the heuristic path.
 */
export async function ask<T>(opts: {
  system: string;
  prompt: string;
  schema: JsonSchema;
  maxTokens?: number;
}): Promise<T | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    output_config: { format: { type: 'json_schema', schema: opts.schema } },
    messages: [{ role: 'user', content: opts.prompt }],
  });

  if (res.stop_reason === 'refusal') return null;
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  try {
    return JSON.parse(text.text) as T;
  } catch {
    return null;
  }
}
