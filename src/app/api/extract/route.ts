/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createWorker } from "tesseract.js";

// SKU pattern: 3-4 digits, dash, 3 digits, dash, 3 digits
// e.g. 0000-417-725 or 1008-665-104
const SKU_RE = /\b(\d{3,4}-\d{3}-\d{3})\b/g;

// Location patterns: e.g. 12-010-101 or AISLE 10 BAY 009 or 33-010
const LOC_RE = /\b(\d{1,2}-\d{3}(?:-\d{3})?|AISLE\s+\d+\s*(?:BAY\s*)?\d*)/gi;

const PRICE_RE = /\$[\d.]+/;

interface ExtractedItem {
  sku: string;
  description: string;
  location: string;
}

function parseOcrText(raw: string): ExtractedItem[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ExtractedItem[] = [];
  const usedSkus = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const skuMatches = Array.from(line.matchAll(new RegExp(SKU_RE.source, "g")));

    for (const match of skuMatches) {
      const sku = match[1];
      if (usedSkus.has(sku)) continue;
      usedSkus.add(sku);

      // Search nearby lines for description (all-caps text, not a price/sku/location)
      let description = "";
      const windowStart = Math.max(0, i - 4);
      const windowEnd = Math.min(lines.length, i + 5);
      const windowLines = lines.slice(windowStart, windowEnd);

      for (const wl of windowLines) {
        if (new RegExp(SKU_RE.source).test(wl)) continue;
        if (PRICE_RE.test(wl)) continue;
        if (new RegExp(LOC_RE.source, "i").test(wl)) continue;
        const lettersOnly = wl.replace(/[^A-Za-z ]/g, "");
        if (lettersOnly.length > 3 && lettersOnly === lettersOnly.toUpperCase()) {
          description = wl.replace(/[^\w\s\-\/%.'"]/g, "").trim();
          break;
        }
      }

      // Search nearby lines for location
      let location = "";
      const locWindowLines = lines.slice(
        Math.max(0, i - 3),
        Math.min(lines.length, i + 4)
      );
      for (const wl of locWindowLines) {
        const lm = wl.match(new RegExp(LOC_RE.source, "i"));
        if (lm && lm[0] !== sku) {
          location = lm[0];
          break;
        }
      }

      results.push({ sku, description, location });
    }
  }

  return results;
}

async function runTesseract(imageBuffer: Buffer): Promise<ExtractedItem[]> {
  const worker = await createWorker("eng");
  try {
    const dataUrl = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;
    const { data } = await worker.recognize(dataUrl);
    console.log("Tesseract raw text:", data.text.slice(0, 200));
    return parseOcrText(data.text);
  } finally {
    await worker.terminate();
  }
}

async function runAnthropic(
  imageData: string,
  mediaType: string
): Promise<ExtractedItem[]> {
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

  const text = (d.content as any[])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text || "")
    .join("");

  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

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

    // 1. Try Tesseract first (free, no API cost)
    let items: ExtractedItem[] = [];
    let usedFallback = false;

    try {
      console.log("Attempting Tesseract OCR...");
      items = await runTesseract(imageBuffer);
      console.log(`Tesseract found ${items.length} items`);
    } catch (err) {
      console.warn("Tesseract failed:", err);
    }

    // 2. Fall back to Anthropic only if Tesseract found nothing
    if (items.length === 0) {
      console.log("Tesseract found 0 items — falling back to Anthropic API");
      try {
        items = await runAnthropic(imageData, mediaType);
        usedFallback = true;
        console.log(`Anthropic fallback found ${items.length} items`);
      } catch (err) {
        console.error("Anthropic fallback failed:", err);
        return NextResponse.json(
          { error: "Could not extract data — both OCR and AI fallback failed." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ items, usedFallback });
  } catch (err) {
    console.error("Unexpected error in /api/extract:", err);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
