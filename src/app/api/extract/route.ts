import { NextRequest, NextResponse } from "next/server";
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

    let body;
    try { body = await req.json(); }
    catch (e) { return NextResponse.json({ error: "Bad request body: " + e }, { status: 400 }); }

    const { imageData, mediaType } = body;
    if (!imageData) return NextResponse.json({ error: "No imageData" }, { status: 400 });

    let r, d;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageData } },
            { type: "text", text: `Extract all retail product SKUs from this image. Return ONLY a JSON array, no markdown, no explanation:\n[{"sku":"number with dashes e.g. 0000-417-725","description":"PRODUCT NAME or empty string","location":"aisle/bay or empty string"}]` }
          ]}]
        })
      });
      d = await r.json();
    } catch (e) {
      console.error("Fetch failed:", e);
      return NextResponse.json({ error: "Fetch error: " + e }, { status: 500 });
    }

    if (!r.ok) {
      console.error("Anthropic error:", JSON.stringify(d));
      return NextResponse.json({ error: JSON.stringify(d?.error || d) }, { status: 500 });
    }

    try {
      const text = (d.content || []).filter((b: {type:string}) => b.type === "text").map((b: {text:string}) => b.text).join("");
      const items = JSON.parse(text.replace(/```json|```/g, "").trim());
      return NextResponse.json({ items });
    } catch (e) {
      console.error("Parse error:", e, "Response:", JSON.stringify(d).slice(0, 300));
      return NextResponse.json({ error: "Parse failed" }, { status: 500 });
    }

  } catch (e) {
    console.error("Outer catch:", e);
    return NextResponse.json({ error: "Unexpected error: " + e }, { status: 500 });
  }
}