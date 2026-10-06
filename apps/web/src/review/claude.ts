import Anthropic from '@anthropic-ai/sdk';
import type { ReviewPrompt } from '@loadline/scenarios';

// Asking Claude for a review, from the browser, with the visitor's own key. There is no server in
// between: the request goes from this page to api.anthropic.com and nowhere else, which the
// page's content security policy also enforces.

export const REVIEW_MODEL = 'claude-opus-5-5';

/**
 * Why a review did not come back.
 * - `key`: the key was refused.
 * - `permission`: the key is real and may not do this.
 * - `rate`: over a rate limit, or out of credit.
 * - `network`: the request never got an answer.
 * - `refused`: the model, and whatever it fell back to, declined.
 * - `other`: anything else; `message` says what.
 */
export type ReviewFailure = 'key' | 'permission' | 'rate' | 'network' | 'refused' | 'other';

export type ReviewResult =
  /** `cutShort` is set when the reply ran into the limit on its length. */
  | { ok: true; text: string; model: string; cutShort: boolean }
  | { ok: false; why: ReviewFailure; message: string };

export interface ReviewRequest {
  apiKey: string;
  prompt: ReviewPrompt;
  /** Called with each piece of the reply as it arrives. */
  onText: (delta: string) => void;
  /** Stops the request. */
  signal?: AbortSignal;
  /** In place of the network, for tests. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Sends the prompt and streams the reply. It never throws for a refused key, a full rate limit or
 * a dropped connection: those are results, with a reason the interface can put into words. An
 * aborted request rejects, as the caller asked for it.
 */
export async function requestReview({ apiKey, prompt, onText, signal, fetch }: ReviewRequest): Promise<ReviewResult> {
  const client = new Anthropic({
    apiKey,
    // The key is the visitor's own, typed into their own browser, for a request made on their
    // behalf. That is the case this switch exists for.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    ...(fetch ? { fetch } : {}),
  });

  try {
    const stream = client.beta.messages.stream(
      {
        model: REVIEW_MODEL,
        max_tokens: 64_000,
        // If the model declines, the API tries the model Anthropic recommends for that refusal
        // instead of handing the refusal back.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Thinking is always on for this model; how much is set here. A review is analysis.
        output_config: { effort: 'high' },
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      },
      signal ? { signal } : undefined,
    );
    stream.on('text', onText);
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') return { ok: false, why: 'refused', message: message.stop_details?.explanation ?? '' };
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    return { ok: true, text, model: message.model, cutShort: message.stop_reason === 'max_tokens' };
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError) throw error;
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, why: 'key', message: error.message };
    if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, why: 'permission', message: error.message };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, why: 'rate', message: error.message };
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, why: 'network', message: error.message };
    if (error instanceof Anthropic.APIError) return { ok: false, why: 'other', message: error.message };
    throw error;
  }
}
