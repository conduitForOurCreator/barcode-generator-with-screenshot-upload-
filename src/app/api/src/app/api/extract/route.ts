import { NextRequest, NextResponse } from "next/server";

const PROMPT = `You are extracting product data from a retail store image. The image may be one of three types:

TYPE A — Handheld device screen (Symbol or Zebra): shows a product detail screen with an item number near an ACTIVE badge or labeled SKU:, a product description, and a location code.

TYPE B — Shelf price label: shows a price tag with a SKU number in format 0000-000-000, a short product description, and AISLE/BAY numbers.

TYPE C — Plain list of SKU numbers: just a list of item numbers, one per line, with dashes. No descriptions or locations.

Extract ALL items visible. Return ONLY a raw JSON array with no markdown, no backticks, no explanation:
[{"sku":"item number exactly as shown including dashes e.g. 0000-417-725","description":"PRODUCT NAME IN CAPS or empty string if not shown","location":"location/aisle/bay or empty string if not shown"}]

For TYPE C set description and location to empty string. Extract every SKU visible, not just the first.`;

export async function POST(req: NextRequest) {
  try {
    const { imageData, mediaType } = await req.json();

    if (!imageData || !mediaType) {
      return NextResponse.json({ error: "Missing imageData or mediaType" }, { status: 400 });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageData },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data?.error?.message || "Anthropic API error" }, { status: 500 });
    }

    const text = data.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    const clean = text.replace(/```json|```/g, "").trim();
    const items = JSON.parse(clean);

    return NextResponse.json({ items });
  } catch (err) {
    console.error("Extract route error:", err);
    return NextResponse.json({ error: "Failed to process image" }, { status: 500 });
  }
}
