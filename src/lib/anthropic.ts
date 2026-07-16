import "server-only";

/**
 * Minimal Anthropic Messages API client — a thin `fetch` wrapper, no SDK, so it
 * runs on Cloudflare Workers without Node built-ins (same reasoning as our
 * hand-rolled Privy verification). Used to read biomarker values off a lab PDF.
 *
 * The request is streamed (SSE) and the text deltas are accumulated. Streaming
 * is what the API guidance recommends for long input / high max_tokens: a
 * 40-page PDF read takes many seconds, and a non-streamed request can trip a
 * request timeout and surface as a 502. Transient overloads (429/500/529) are
 * retried once with a short backoff.
 *
 * The API key is a Worker secret (`ANTHROPIC_API_KEY`, set via
 * `wrangler secret put`); it is never committed. The model is overridable via
 * `ANTHROPIC_EXTRACTION_MODEL` so we can move to a cheaper model as volume grows
 * (see docs/SCALING.md) without a code change.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 8192;
const REQUEST_TIMEOUT_MS = 55_000;

export class AnthropicError extends Error {}
export class AnthropicNotConfiguredError extends AnthropicError {}
/** Transient failures (429/500/529, network) — caller may tell the user to retry. */
export class AnthropicOverloadedError extends AnthropicError {}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
}

/**
 * Send a base64 PDF plus an instruction and return the model's text response.
 * Streams the response and concatenates the text blocks. Throws
 * AnthropicNotConfiguredError if the key is missing (caller → 503),
 * AnthropicOverloadedError on a transient failure (caller → 503 "busy"), and
 * AnthropicError on any other non-2xx or unexpected shape (caller → 502).
 */
export async function extractFromPdf(params: {
  base64Pdf: string;
  prompt: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicNotConfiguredError("ANTHROPIC_API_KEY is not set");
  }
  const model = process.env.ANTHROPIC_EXTRACTION_MODEL || DEFAULT_MODEL;

  const body = JSON.stringify({
    model,
    max_tokens: MAX_TOKENS,
    stream: true,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: params.base64Pdf,
            },
          },
          { type: "text", text: params.prompt },
        ],
      },
    ],
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(2000);
    try {
      return await streamOnce(apiKey, body);
    } catch (err) {
      lastError = err;
      // Only retry transient failures; surface everything else immediately.
      if (err instanceof AnthropicOverloadedError) continue;
      throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AnthropicOverloadedError("Anthropic request failed");
}

async function streamOnce(apiKey: string, body: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      signal: controller.signal,
      body,
    });
  } catch (err) {
    clearTimeout(timer);
    // A timeout abort won't get faster on retry — surface it directly.
    if (controller.signal.aborted) {
      throw new AnthropicError(
        `Anthropic request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }
    // Other network failures are transient — allow one retry.
    throw new AnthropicOverloadedError(
      `Anthropic request did not complete: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    clearTimeout(timer);
    const message = `Anthropic request failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`;
    if (isRetryableStatus(res.status)) throw new AnthropicOverloadedError(message);
    throw new AnthropicError(message);
  }

  try {
    return await readTextFromStream(res.body);
  } finally {
    clearTimeout(timer);
  }
}

/** Accumulate text_delta content from the Messages SSE stream. */
async function readTextFromStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let event: unknown;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        const e = event as {
          type?: string;
          delta?: { type?: string; text?: string };
          error?: { message?: string };
        };
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
          text += e.delta.text ?? "";
        } else if (e.type === "error") {
          throw new AnthropicOverloadedError(
            `Anthropic stream error: ${e.error?.message ?? "unknown"}`,
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const out = text.trim();
  if (!out) throw new AnthropicError("Anthropic returned no text content");
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
