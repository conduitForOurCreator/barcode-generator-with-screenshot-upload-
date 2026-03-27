import { NextRequest, NextResponse } from "next/server";
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });
  const { imageData, mediaType } = await req.json();
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
        { type: "text", text: `Extract all retail product SKUs from this image. Return ONLY a JSON array, no markdown:
[{"sku":"number with dashes e.g. 0000-417-725","description":"PRODUCT NAME or empty string","location":"aisle/bay or empty string"}]
If it is a plain list of SKU numbers, set description and location to empty string.` }
      ]}]
    })
  });
  const d = await r.json();
  if (!r.ok) return NextResponse.json({ error: d?.error?.message || "API error" }, { status: 500 });
  const text = d.content.filter((b: {type:string}) => b.type === "text").map((b: {text:string}) => b.text).join("");
  try {
    const items = JSON.parse(text.replace(/```json|```/g, "").trim());
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Parse failed: " + text.slice(0, 100) }, { status: 500 });
  }
}
