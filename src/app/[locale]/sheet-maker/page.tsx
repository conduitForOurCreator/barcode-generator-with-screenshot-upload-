"use client";

import { useState, useEffect, useRef } from "react";

const BRAND = "#e85d04";
const uid = () => Math.random().toString(36).slice(2, 9);
const stripDashes = (s: string) => (s || "").replace(/-/g, "");

interface Item {
  id: string;
  sku: string;
  description: string;
  location: string;
}

interface Job {
  name: string;
  st: "wait" | "run" | "ok" | "err";
  n?: number;
}

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function extractFromImage(file: File): Promise<Item[]> {
  const imageData = await toBase64(file);
  const mediaType = file.type || "image/jpeg";

  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageData, mediaType }),
  });

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Extraction failed");
  return data.items.map((g: Omit<Item, "id">) => ({ ...g, id: uid() }));
}

function BarcodeBar({ sku, ready, h = 44 }: { sku: string; ready: boolean; h?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const val = stripDashes(sku);
  useEffect(() => {
    if (!ready || !svgRef.current || !val || !(window as { JsBarcode?: (el: SVGSVGElement, val: string, opts: object) => void }).JsBarcode) return;
    try {
      (window as { JsBarcode?: (el: SVGSVGElement, val: string, opts: object) => void }).JsBarcode!(svgRef.current, val, {
        format: "CODE128", displayValue: false,
        margin: 2, height: h, width: 1.5,
      });
    } catch (e) { console.warn("Barcode:", val, e); }
  }, [val, ready, h]);
  if (!val) return (
    <div style={{ height: h + 8, background: "#f5f5f5", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 10, color: "#bbb" }}>no SKU</span>
    </div>
  );
  return <svg ref={svgRef} style={{ width: "100%", display: "block" }} />;
}

function BarcodeCard({ item, ready, compact }: { item: Item; ready: boolean; compact: boolean }) {
  const fs = compact ? { sku: 8.5, desc: 7.5, loc: 7.5 } : { sku: 11, desc: 10, loc: 10 };
  const pad = compact ? "3px 5px 4px" : "6px 8px 7px";
  return (
    <div style={{ border: "1px solid #999", padding: pad, background: "#fff", pageBreakInside: "avoid", breakInside: "avoid" }}>
      <BarcodeBar sku={item.sku} ready={ready} h={compact ? 34 : 44} />
      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: fs.sku, lineHeight: 1.3, marginTop: 1 }}>{item.sku}</div>
      {item.description && <div style={{ fontSize: fs.desc, color: "#222", lineHeight: 1.2, marginTop: 1 }}>{item.description}</div>}
      {item.location && <div style={{ fontSize: fs.loc, color: "#555", marginTop: 1, fontWeight: 700 }}>{item.location}</div>}
    </div>
  );
}

function BarcodeGrid({ items, cols, ready, compact }: { items: Item[]; cols: number; ready: boolean; compact: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: compact ? "3px" : "8px" }}>
      {items.map(item => <BarcodeCard key={item.id} item={item} ready={ready} compact={compact} />)}
    </div>
  );
}

const ICON: Record<string, string> = { wait: "⬜", run: "⏳", ok: "✅", err: "❌" };

export default function SheetMaker() {
  const [tab, setTab] = useState<"photos" | "text">("photos");
  const [items, setItems] = useState<Item[]>([]);
  const [cols, setCols] = useState(3);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [skuText, setSkuText] = useState("");
  const [jsb, setJsb] = useState(false);

  useEffect(() => {
    if ((window as { JsBarcode?: unknown }).JsBarcode) { setJsb(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js";
    s.onload = () => setJsb(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    const st = document.createElement("style");
    st.textContent = `
      #pzone { position:fixed; left:-9999px; top:0; width:7.6in; background:white; }
      @media print {
        body * { visibility:hidden !important; }
        #pzone { visibility:visible !important; position:fixed !important; left:0 !important; top:0 !important; width:100% !important; }
        #pzone * { visibility:visible !important; }
        @page { margin:0.35in; size:letter portrait; }
      }
    `;
    document.head.appendChild(st);
    return () => st.remove();
  }, []);

  const handlePhotos = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setLoading(true);
    let offset = 0;
    setJobs(prev => { offset = prev.length; return [...prev, ...files.map(f => ({ name: f.name, st: "wait" as const, n: 0 }))]; });
    await new Promise(r => setTimeout(r, 0));

    const results = await Promise.allSettled(
      files.map(async (file, i) => {
        setJobs(prev => prev.map((j, k) => k === offset + i ? { ...j, st: "run" as const } : j));
        try {
          const got = await extractFromImage(file);
          setJobs(prev => prev.map((j, k) => k === offset + i ? { ...j, st: "ok" as const, n: got.length } : j));
          return got;
        } catch (err) {
          setJobs(prev => prev.map((j, k) => k === offset + i ? { ...j, st: "err" as const } : j));
          throw err;
        }
      })
    );

    const newItems = results
      .filter((r): r is PromiseFulfilledResult<Item[]> => r.status === "fulfilled")
      .flatMap(r => r.value);

    setItems(prev => [...prev, ...newItems]);
    setLoading(false);
  };

  const buildFromText = () => {
    const lines = skuText.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setItems(prev => [...prev, ...lines.map(l => ({ id: uid(), sku: l, description: "", location: "" }))]);
    setSkuText("");
  };

  const update = (id: string, f: keyof Item, v: string) => setItems(p => p.map(i => i.id === id ? { ...i, [f]: v } : i));
  const remove = (id: string) => setItems(p => p.filter(i => i.id !== id));
  const addRow = () => setItems(p => [...p, { id: uid(), sku: "", description: "", location: "" }]);
  const clearAll = () => { setItems([]); setJobs([]); };

  const INPUT: React.CSSProperties = {
    border: "1px solid #e5e7eb", borderRadius: 4, padding: "3px 6px",
    fontSize: 11, boxSizing: "border-box", background: "#fff",
  };
  const hasItems = items.length > 0;

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", minHeight: "100vh", background: "#f2f2f2" }}>

      <div id="pzone">
        {jsb && hasItems && <BarcodeGrid items={items} cols={cols} ready={jsb} compact />}
      </div>

      <div style={{ maxWidth: 580, margin: "0 auto", padding: "14px 14px 56px" }}>

        <div style={{ textAlign: "center", padding: "14px 0 20px" }}>
          <div style={{ fontSize: 30 }}>🏷️</div>
          <h1 style={{ margin: "6px 0 3px", fontSize: 20, fontWeight: 800, letterSpacing: -0.5, color: "#111" }}>
            Retail Barcode Sheet Maker
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#999" }}>
            Screenshots · shelf labels · SKU lists → print a full sheet
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {([["photos", "📸  Scan Photos"], ["text", "📋  SKU List"]] as const).map(([t, lbl]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "11px 0", borderRadius: 9, cursor: "pointer",
              fontWeight: 600, fontSize: 14,
              border: `2px solid ${tab === t ? BRAND : "#ddd"}`,
              background: tab === t ? "#fff4ee" : "#fff",
              color: tab === t ? BRAND : "#555",
            }}>{lbl}</button>
          ))}
        </div>

        {tab === "photos" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              minHeight: 140, border: `2px dashed ${loading ? BRAND : "#d1d5db"}`,
              borderRadius: 12, background: loading ? "#fff9f6" : "#fff",
              cursor: loading ? "wait" : "pointer", padding: 20,
            }}>
              <div style={{ fontSize: 40 }}>{loading ? "⏳" : "📸"}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginTop: 8, color: "#222" }}>
                {loading ? "Processing images in parallel…" : "Upload Screenshots"}
              </div>
              <div style={{ fontSize: 12, color: "#aaa", marginTop: 5, textAlign: "center", lineHeight: 1.5 }}>
                {loading
                  ? "All images running simultaneously — results appear as each finishes"
                  : "Tap · select as many as needed in one go"}
              </div>
              <input type="file" multiple accept="image/*" style={{ display: "none" }}
                onChange={e => e.target.files && handlePhotos(e.target.files)} disabled={loading} />
            </label>
            <div style={{ fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 6 }}>
              Reads device screens · shelf labels · printed or written SKU number lists
            </div>
            {jobs.length > 0 && (
              <div style={{ marginTop: 10, background: "#fff", borderRadius: 10, border: "1px solid #eee", overflow: "hidden" }}>
                {jobs.map((j, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
                    borderBottom: i < jobs.length - 1 ? "1px solid #f5f5f5" : "none", fontSize: 13,
                  }}>
                    <span style={{ fontSize: 16 }}>{ICON[j.st]}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#444" }}>{j.name}</span>
                    <span style={{ color: j.st === "err" ? "#e53e3e" : "#aaa", fontSize: 12, whiteSpace: "nowrap" }}>
                      {j.st === "ok" && `${j.n} item${j.n !== 1 ? "s" : ""}`}
                      {j.st === "run" && "Reading…"}
                      {j.st === "err" && "Couldn't read"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "text" && (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              background: "#fff8f3", borderRadius: 9, border: `1px solid #fde8d8`,
              padding: "10px 14px", marginBottom: 10, fontSize: 13, color: "#555", lineHeight: 1.6,
            }}>
              Paste or type one SKU per line.&nbsp;
              <span style={{ color: BRAND, fontWeight: 700 }}>Dashes are stripped from the barcode</span> automatically — they stay visible as text below each barcode.
            </div>
            <textarea
              value={skuText}
              onChange={e => setSkuText(e.target.value)}
              placeholder={"1002-229-572\n1003-231-014\n1014-416-565\n1013-627-717\n1001-091-723"}
              style={{
                width: "100%", height: 200, padding: 10,
                border: "1px solid #ddd", borderRadius: 8,
                fontSize: 14, fontFamily: "monospace",
                resize: "vertical", boxSizing: "border-box",
              }}
            />
            <button onClick={buildFromText} disabled={!skuText.trim()} style={{
              marginTop: 8, width: "100%", padding: 11,
              background: skuText.trim() ? BRAND : "#d1d5db",
              color: "#fff", border: "none", borderRadius: 8,
              fontWeight: 700, fontSize: 14,
              cursor: skuText.trim() ? "pointer" : "default",
            }}>Add to Sheet →</button>
          </div>
        )}

        {hasItems && (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: 14 }}>
            <div style={{
              padding: "10px 14px", background: "#fafafa", borderBottom: "1px solid #eee",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <b style={{ fontSize: 14 }}>Items ({items.length})</b>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#ccc" }}>tap any field to correct</span>
                <button onClick={clearAll} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12 }}>Clear all</button>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {[["SKU", 110], ["Description", null], ["Location", 80], ["", 28]].map(([h, w]) => (
                      <th key={String(h)} style={{ padding: "6px 8px", textAlign: "left", color: "#888", fontWeight: 600, borderBottom: "1px solid #eee", fontSize: 11, width: w ? Number(w) : undefined }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={{ padding: "4px 6px" }}>
                        <input value={item.sku} onChange={e => update(item.id, "sku", e.target.value)}
                          style={{ ...INPUT, width: 110, fontFamily: "monospace" }} />
                      </td>
                      <td style={{ padding: "4px 6px", minWidth: 120 }}>
                        <input value={item.description} onChange={e => update(item.id, "description", e.target.value)}
                          style={{ ...INPUT, width: "100%" }} />
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        <input value={item.location} onChange={e => update(item.id, "location", e.target.value)}
                          style={{ ...INPUT, width: 80 }} />
                      </td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>
                        <button onClick={() => remove(item.id)}
                          style={{ background: "none", border: "none", color: "#ddd", cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "7px 12px" }}>
              <button onClick={addRow} style={{
                border: "1px dashed #ddd", borderRadius: 6, padding: "4px 12px",
                background: "none", color: "#bbb", cursor: "pointer", fontSize: 12,
              }}>+ Add row manually</button>
            </div>
          </div>
        )}

        {hasItems && (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Columns per row</div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>more = smaller cards, more per page</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setCols(n)} style={{
                    width: 38, height: 38, borderRadius: 7, fontWeight: 700, fontSize: 14, cursor: "pointer",
                    border: `2px solid ${cols === n ? BRAND : "#ddd"}`,
                    background: cols === n ? "#fff4ee" : "#fff",
                    color: cols === n ? BRAND : "#555",
                  }}>{n}</button>
                ))}
              </div>
            </div>
            <button onClick={() => window.print()} disabled={!jsb} style={{
              width: "100%", padding: 14,
              background: jsb ? BRAND : "#d1d5db",
              color: "#fff", border: "none", borderRadius: 8,
              fontWeight: 800, fontSize: 17, cursor: jsb ? "pointer" : "default",
            }}>
              {jsb ? "🖨️  Print Barcode Sheet" : "Loading barcode engine…"}
            </button>
            <div style={{ fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 8, lineHeight: 1.7 }}>
              Letter size · 0.35&quot; margins · dashes removed from barcode<br />
              SKU with dashes prints as text · location prints if available
            </div>
          </div>
        )}

        {hasItems && jsb && (
          <div>
            <div style={{ fontSize: 11, color: "#aaa", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
              Preview — {items.length} barcode{items.length !== 1 ? "s" : ""} · {cols} col{cols !== 1 ? "s" : ""}
            </div>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, overflowX: "auto" }}>
              <BarcodeGrid items={items} cols={cols} ready={jsb} compact={false} />
            </div>
          </div>
        )}

        {!hasItems && !loading && (
          <div style={{ textAlign: "center", padding: "36px 16px", color: "#ccc" }}>
            <div style={{ fontSize: 52 }}>📋</div>
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.8 }}>
              Upload device screenshots, shelf label photos,<br />
              a photo of a SKU number list,<br />
              or paste SKUs to build your sheet
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
