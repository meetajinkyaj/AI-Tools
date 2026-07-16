import { extractText, getDocumentProxy } from "unpdf";

import { NextResponse } from "next/server";

import {
  AnthropicNotConfiguredError,
  AnthropicOverloadedError,
  type ExtractionSource,
  extractMarkers,
} from "@/lib/anthropic";
import { getPrivyUserId } from "@/lib/api-auth";
import {
  loadReportCatalog,
  resolveReportUser,
} from "@/lib/biomarker-report-data";
import {
  buildExtractionPrompt,
  hasUsableTextLayer,
  parseExtractionResponse,
} from "@/lib/extraction";

/**
 * Read a lab-report PDF and return a *draft* of the biomarker values found in
 * it, mapped to our catalog. Nothing is saved — the client shows the draft for
 * the user to review/edit, then persists it via POST /api/biomarkers. Flags are
 * intentionally NOT computed here; the save route recomputes them
 * deterministically after the human confirms.
 *
 *   POST /api/biomarkers/extract  (multipart/form-data, field "file")
 *     -> { test_date, lab_name, readings, unmatched }
 */

export const maxDuration = 90;

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_TEXT_CHARS = 400_000; // bound the token count sent to the model

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Prefer the PDF's text layer — a digital lab report extracts in well under a
 * second and reads in seconds, versus a slow, timeout-prone vision pass over
 * every page. Fall back to sending the PDF for vision reading only when there's
 * no usable text layer (e.g. a scanned report).
 */
async function buildSource(bytes: Uint8Array): Promise<ExtractionSource> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    if (hasUsableTextLayer(text)) {
      return { kind: "text", text: text.slice(0, MAX_TEXT_CHARS) };
    }
  } catch (err) {
    console.error("PDF text extraction failed; falling back to vision:", err);
  }
  return { kind: "pdf", base64: toBase64(bytes) };
}

export async function POST(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF uploaded" }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Please upload a PDF file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: "That PDF is too large (max 15 MB)" },
      { status: 413 },
    );
  }

  try {
    const resolved = await resolveReportUser(privyUserId);
    if (!resolved) {
      return NextResponse.json({ error: "User not found" }, { status: 409 });
    }

    const catalog = await loadReportCatalog(resolved.sex);
    const source = await buildSource(new Uint8Array(await file.arrayBuffer()));
    const prompt = buildExtractionPrompt(catalog);

    const raw = await extractMarkers({ prompt, source });
    const result = parseExtractionResponse(raw, catalog);

    if (result.readings.length === 0) {
      return NextResponse.json(
        {
          error:
            "We couldn't read any recognized markers from that PDF. Try a clearer copy of the lab report.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AnthropicNotConfiguredError) {
      console.error("Extraction unavailable:", err);
      return NextResponse.json(
        { error: "PDF reading isn't available right now. Please try again later." },
        { status: 503 },
      );
    }
    if (err instanceof AnthropicOverloadedError) {
      // Transient (rate limit / overload / timeout) — the message survived a retry.
      console.error("Extraction temporarily unavailable:", err);
      return NextResponse.json(
        { error: "The reader is busy right now. Please try again in a moment." },
        { status: 503 },
      );
    }
    console.error("POST /api/biomarkers/extract failed:", err);
    return NextResponse.json(
      { error: "We couldn't read that PDF. Please try again." },
      { status: 502 },
    );
  }
}
