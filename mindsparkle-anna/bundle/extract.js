/**
 * Client-side document text extraction (avoids huge stdio tool payloads).
 */
import * as pdfjs from "./vendor/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

function extOf(name = "") {
  const parts = String(name).toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

async function extractDocx(arrayBuffer) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip not loaded");
  }
  const zip = await JSZip.loadAsync(arrayBuffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("Invalid DOCX (missing document.xml)");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const texts = [...doc.getElementsByTagName("w:t")].map((n) => n.textContent || "");
  // Prefer paragraphs
  const paras = [...doc.getElementsByTagName("w:p")]
    .map((p) => [...p.getElementsByTagName("w:t")].map((t) => t.textContent || "").join(""))
    .map((s) => s.trim())
    .filter(Boolean);
  return (paras.length ? paras.join("\n\n") : texts.join(" ")).trim();
}

async function extractPdf(arrayBuffer) {
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const chunks = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    if (text.trim()) chunks.push(text.trim());
  }
  return chunks.join("\n\n").trim();
}

export async function extractLocalFile(file) {
  const ext = extOf(file.name);
  const mime = (file.type || "").toLowerCase();

  if (
    ["txt", "md", "markdown", "csv", "json", "log", "html", "htm"].includes(ext) ||
    mime.startsWith("text/")
  ) {
    const text = (await file.text()).trim();
    return { text, engine: "browser-text", ext };
  }

  const buf = await file.arrayBuffer();

  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const text = await extractDocx(buf);
    return { text, engine: "browser-docx", ext: "docx" };
  }

  if (ext === "pdf" || mime === "application/pdf") {
    const text = await extractPdf(buf);
    return { text, engine: "browser-pdf", ext: "pdf" };
  }

  // best-effort
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf).trim();
  return { text, engine: "browser-fallback", ext: ext || "bin" };
}
