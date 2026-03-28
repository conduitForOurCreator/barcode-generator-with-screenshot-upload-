import { NextRequest, NextResponse } from "next/server";
import Tesseract from "tesseract.js";

// ── SKU pattern: 4-3-3 digits e.g. 0000-417-725 or 1008-665-104 ──
const SKU_RE = /\b(\d{3,4}-\d{3}-\d{3})\b/g;

// ── Location patterns: e.g. "12-010-101" or "AISLE 10 BAY 009" or "33-010" ──
const LOC_RE = /\b(\d{1,2}-\d{3}(?:-\d{3})?|\d{2}-\d{3}|AISLE\s+\d+\s+BAY\s+\d+)/gi;

// ── Price line — helps us find the description line nearby ──
const PRICE_RE = /\$[\d.]+/;

function parseOcrText(raw: string): Array<{ sku: string; description: string; location: string }> {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const results: Array<{ sku: string; description: string; location: string }> = [];
  const usedSkus = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const skuMatches = [...line.matchAll(SKU_RE)];

    for (const match of skuMatches) {
      const sku = match[1];
      if (usedSkus.has(sku)) continue;
      usedSkus.add(sku);

      // ── Look for description: line before or after SKU that is
      //    ALL CAPS text and not a price / SKU / location ──
      let description = "";
      const window = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5));
      for (const wl of window) {
        if (SKU_RE.test(wl)) { SKU_RE.lastIndex = 0; continue; }
        SKU_RE.lastIndex = 0;
        if (PRICE_RE.test(wl)) continue;
        if (LOC_RE.test(wl)) { LOC_RE.lastIndex = 0; continue; }
        LOC_RE.lastIndex = 0;
        // Must be mostly uppercase letters and spaces — likely a product name
        const upper = wl.replace(/[^A-Za-z ]/g, "");
        if (upper.length > 3 && upper === upper.toUpperCase()) {
          description = wl.replace(/[^\w\s\-\/%.'"]/g, "").trim();
          break;
        }
      }

      // ── Look for location in surrounding lines ──
      let location = "";
      const locWindow = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4));
      for (const wl of locWindow) {
        const lm = wl.match(LOC_RE);
        if (lm) {
          // Exclude the SKU itself being matched as a location
          const candidate = lm[0];
          if (candidate !== sku) {
            location = candidate;
            break;
          }
        }
      }

      results.push({ sku, description, location });
    }
  }

  return results;
}

async function runTesseract(
  imageBuffer: Buffer,
  mediaType: string
): Promise<Array<{ sku: string; description: string; location: string }>> {
  // Convert buffer to base64 data URL for Tesseract
  const dataUrl = `data:${mediaType};base64,${imageBuffer.toString("base64")}`;

  const { data } = await Tesseract.recognize(dataUrl, "eng", {
    // Optimise for sparse text on a clean background
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
  } as Tesseract.RecognizeOptions);

  const items = parseOcrText(data.text);
  return items;
}

async function runAnthropic(
  imageData: string,
  mediaType: string
): Promise<Array<{ sku: string; description: string; location: string }>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No ANTHROPIC_API_KEY set");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageData },
            },
            {
              type: "text",
              text: `Extract all retail product SKUs from this image. Return ONLY a JSON array, no markdown:
[{"sku":"number with dashes e.g. 0000-417-725","description":"PRODUCT NAME or empty string","location":"aisle/bay or empty string"}]
If it is a plain list of SKU numbers, set description and location to empty string.`,
            },
          ],
        },
      ],
    }),
  });

  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || JSON.stringify(d));

  const text = (d.content as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text || "")
    .join("");

  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ── Main handler ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    let body: { imageData?: string; mediaType?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { imageData, mediaType = "image/jpeg" } = body;
    if (!imageData) {
      return NextResponse.json({ error: "No imageData provided" }, { status: 400 });
    }

    const imageBuffer = Buffer.from(imageData, "base64");

    // ── 1. Try Tesseract first ────────────────────────────────────
    let items: Array<{ sku: string; description: string; location: string }> = [];
    let usedFallback = false;

    try {
      console.log("Attempting Tesseract OCR...");
      items = await runTesseract(imageBuffer, mediaType);
      console.log(`Tesseract found ${items.length} items`);
    } catch (err) {
      console.warn("Tesseract failed:", err);
    }

    // ── 2. Fall back to Anthropic if Tesseract found nothing ──────
    if (items.length === 0) {
      console.log("No SKUs from Tesseract — falling back to Anthropic API");
      try {
        items = await runAnthropic(imageData, mediaType);
        usedFallback = true;
        console.log(`Anthropic fallback found ${items.length} items`);
      } catch (err) {
        console.error("Anthropic fallback also failed:", err);
        return NextResponse.json(
          { error: "Could not extract data from image. OCR and AI fallback both failed." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ items, usedFallback });
  } catch (err) {
    console.error("Outer error in /api/extract:", err);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
