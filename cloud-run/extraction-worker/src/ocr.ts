export async function runOcr(params: {
  ocrServiceUrl: string;
  signedUrl: string;
  mimeType: string;
  fileSize: number;
  documentId: string;
  pageStart: number;
  pageEnd: number;
  timeoutMs?: number;
}): Promise<{ text: string; confidence: number } | null> {
  const url = params.ocrServiceUrl.replace(/\/$/, "") + "/ocr";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signedUrl: params.signedUrl,
        fileSize: params.fileSize,
        mimeType: params.mimeType,
        documentId: params.documentId,
        pageStart: params.pageStart,
        pageEnd: params.pageEnd,
      }),
      signal: controller.signal,
    });

    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.success) return null;
    const text = String(json?.text || "").trim();
    if (!text) return null;

    // Cloud Run OCR doesn't provide confidence; use a conservative default.
    return { text, confidence: 0.7 };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
