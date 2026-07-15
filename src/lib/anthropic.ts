import "server-only";

/**
 * Minimal Anthropic Messages API client — a thin `fetch` wrapper, no SDK, so it
 * runs on Cloudflare Workers without Node built-ins (same reasoning as our
 * hand-rolled Privy verification). Used to read biomarker values off a lab PDF.
 *
 * The API key is a Worker secret (`ANTHROPIC_API_KEY`, set via
 * `wrangler secret put`); it is never committed. The model is overridable via
 * `ANTHROPIC_EXTRACTION_MODEL` so we can move to a cheaper model as volume grows
 * (see docs/SCALING.md) without a code change.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 4096;

export class AnthropicError extends Error {}
export class AnthropicNotConfiguredError extends AnthropicError {}

/**
 * Send a base64 PDF plus an instruction and return the model's text response.
 * Throws AnthropicNotConfiguredError if the key is missing (caller → 503) and
 * AnthropicError on a non-2xx or unexpected shape (caller → 502).
 */
export async function extractFromPdf(params: {
  base64Pdf: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicNotConfiguredError("ANTHROPIC_API_KEY is not set");
  }
  const model = process.env.ANTHROPIC_EXTRACTION_MODEL || DEFAULT_MODEL;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
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
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AnthropicError(
      `Anthropic request failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  if (!text) {
    throw new AnthropicError("Anthropic returned no text content");
  }
  return text;
}
