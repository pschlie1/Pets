import Anthropic from '@anthropic-ai/sdk';

/**
 * Thin wrapper around the Claude API. Returns null on ANY failure — missing
 * key, network error, API error — so callers always fall through to the
 * grounded template fallback. The demo must never break on stage.
 */

let client: Anthropic | null | undefined;

export function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  return client;
}

/** Test hook: force-reset the memoized client (e.g. after env changes). */
export function resetClient(): void {
  client = undefined;
}

export async function callClaude(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    });
    const text = response.content.find((b) => b.type === 'text');
    return text && text.type === 'text' ? text.text : null;
  } catch {
    return null;
  }
}
