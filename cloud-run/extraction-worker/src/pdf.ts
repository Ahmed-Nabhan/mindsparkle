/* eslint-disable @typescript-eslint/no-var-requires */

export type PageQuality = {
  text: string;
  textLength: number;
  printableRatio: number;
  garbageRatio: number;
  isPoor: boolean;
  confidence: number;
};

export type PageInventory = {
  hasImages: boolean;
  imageOpsCount: number;
};

let pdfjsPromise: Promise<any> | null = null;

async function getPdfJs(): Promise<any> {
  // pdfjs-dist v4 ships ESM entrypoints (pdf.mjs). Use dynamic import so this
  // worker can stay CommonJS.
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

export async function loadPdf(bytes: Uint8Array): Promise<any> {
  const pdfjsLib = await getPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: bytes, disableWorker: true });
  return loadingTask.promise;
}

export async function getPdfPageCount(pdf: any): Promise<number> {
  return pdf.numPages || 1;
}

function analyzeTextQuality(text: string): { printableRatio: number; garbageRatio: number; isPoor: boolean; confidence: number } {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  const len = cleaned.length;
  if (len === 0) {
    return { printableRatio: 0, garbageRatio: 1, isPoor: true, confidence: 0.1 };
  }

  let printable = 0;
  let weird = 0;
  for (const ch of cleaned) {
    const code = ch.charCodeAt(0);
    const isPrintable = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code >= 160;
    if (isPrintable) printable += 1;
    else weird += 1;
  }

  const printableRatio = printable / len;
  const garbageRatio = weird / len;
  const isPoor = len < 30 || printableRatio < 0.85;
  const confidence = Math.max(0.05, Math.min(0.95, printableRatio - garbageRatio));
  return { printableRatio, garbageRatio, isPoor, confidence };
}

export async function extractPdfPageText(pdf: any, pageIndex: number): Promise<PageQuality> {
  const page = await pdf.getPage(pageIndex);
  const textContent = await page.getTextContent();
  const parts: string[] = [];
  for (const item of textContent.items || []) {
    const str = (item && item.str) ? String(item.str) : "";
    if (str) parts.push(str);
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  const { printableRatio, garbageRatio, isPoor, confidence } = analyzeTextQuality(text);
  return {
    text,
    textLength: text.length,
    printableRatio,
    garbageRatio,
    isPoor,
    confidence,
  };
}

export async function detectPdfPageInventory(pdf: any, pageIndex: number): Promise<PageInventory> {
  const page = await pdf.getPage(pageIndex);
  const operatorList = await page.getOperatorList();

  // pdfjs-dist exposes image painting ops via OPS constants.
  const pdfjsLib = await getPdfJs();
  const OPS = pdfjsLib.OPS;
  let imageOpsCount = 0;
  if (operatorList && Array.isArray(operatorList.fnArray) && OPS) {
    for (const fn of operatorList.fnArray) {
      if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintJpegXObject ||
        fn === OPS.paintInlineImageXObject
      ) {
        imageOpsCount += 1;
      }
    }
  }

  return {
    hasImages: imageOpsCount > 0,
    imageOpsCount,
  };
}

export async function renderPdfPageToPng(
  pdf: any,
  pageIndex: number,
  options?: { scale?: number }
): Promise<Buffer> {
  const scale = options?.scale ?? 2;

  const page = await pdf.getPage(pageIndex);
  const viewport = page.getViewport({ scale });

  // Use a pure native canvas implementation to avoid system libs.
  const canvasMod: any = await import("@napi-rs/canvas");
  const createCanvas = canvasMod.createCanvas || canvasMod.default?.createCanvas;
  if (!createCanvas) {
    throw new Error("@napi-rs/canvas createCanvas not available");
  }

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");

  // Render (pdfjs worker already disabled in loadPdf)
  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;

  // napi-rs/canvas supports toBuffer
  const buf: Buffer = canvas.toBuffer("image/png");
  return buf;
}
