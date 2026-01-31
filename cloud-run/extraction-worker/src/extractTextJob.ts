import type { SupabaseClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logInfo, logWarn } from "./logger";
import { loadPdf, getPdfPageCount, extractPdfPageText, detectPdfPageInventory, renderPdfPageToPng } from "./pdf";
import { runOcr } from "./ocr";

const execFileAsync = promisify(execFile);

function naturalCompare(a: string, b: string): number {
  // Simple natural sort for filenames like slide_2.png vs slide_10.png
  const ax = a.split(/(\d+)/).map((p) => (p.match(/^\d+$/) ? Number(p) : p));
  const bx = b.split(/(\d+)/).map((p) => (p.match(/^\d+$/) ? Number(p) : p));
  const n = Math.max(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const av: any = ax[i];
    const bv: any = bx[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (typeof av === "number" && typeof bv === "number") {
      if (av !== bv) return av - bv;
    } else {
      const as = String(av);
      const bs = String(bv);
      if (as !== bs) return as.localeCompare(bs);
    }
  }
  return 0;
}

async function tryConvertPptxToPdfBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  // Uses LibreOffice (soffice) inside the container.
  // Returns PDF bytes or null if conversion fails.
  let tmpDir: string | null = null;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mindsparkle-office-"));
    const inputPath = path.join(tmpDir, "input.pptx");
    await fs.writeFile(inputPath, Buffer.from(bytes));

    // NOTE: "soffice" is provided by libreoffice packages.
    // --convert-to pdf generates a PDF in the outdir.
    // Force Impress PDF export to avoid writer/draw defaults that can produce
    // unexpected layouts (e.g., sidebar/handout-like pages).
    await execFileAsync(
      "soffice",
      [
        "--headless",
        "--nologo",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        "--convert-to",
        "pdf:impress_pdf_Export",
        "--outdir",
        tmpDir,
        inputPath,
      ],
      { timeout: 10 * 60 * 1000 }
    );

    const files = await fs.readdir(tmpDir);
    const pdfName = files.find((f) => f.toLowerCase().endsWith(".pdf")) || null;
    if (!pdfName) return null;
    const pdfPath = path.join(tmpDir, pdfName);
    const pdfBuf = await fs.readFile(pdfPath);
    return new Uint8Array(pdfBuf);
  } catch {
    return null;
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function tryConvertPptxToPngSlides(bytes: Uint8Array): Promise<Buffer[] | null> {
  // Uses LibreOffice (soffice) inside the container.
  // Returns slide PNG buffers or null if conversion fails.
  let tmpDir: string | null = null;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mindsparkle-office-"));
    const inputPath = path.join(tmpDir, "input.pptx");
    await fs.writeFile(inputPath, Buffer.from(bytes));

    // Convert slides directly to PNG. This avoids PDF export artifacts like
    // thumbnail panes / split layouts.
    await execFileAsync(
      "soffice",
      [
        "--headless",
        "--nologo",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        "--convert-to",
        "png",
        "--outdir",
        tmpDir,
        inputPath,
      ],
      { timeout: 10 * 60 * 1000 }
    );

    const files = (await fs.readdir(tmpDir)).filter((f) => f.toLowerCase().endsWith(".png"));
    if (files.length === 0) return null;

    const ordered = files.sort(naturalCompare);
    const out: Buffer[] = [];
    for (const name of ordered) {
      const full = path.join(tmpDir, name);
      out.push(await fs.readFile(full));
    }

    return out;
  } catch {
    return null;
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function renderPdfPreviewsToStorage(params: {
  supabase: SupabaseClient;
  documentId: string;
  pdfBytes: Uint8Array;
  targetPageCount: number;
  jobId: string;
  scale?: number;
}): Promise<void> {
  const { supabase, documentId, pdfBytes, targetPageCount, jobId } = params;
  const scale = params.scale ?? 1.35;
  const pdf = await loadPdf(pdfBytes);
  const actualCount = await getPdfPageCount(pdf);
  const pageCount = Math.max(1, Math.min(targetPageCount, actualCount || 1));

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
    try {
      const png = await renderPdfPageToPng(pdf, pageIndex, { scale });
      const name = `${documentId}/page_${String(pageIndex).padStart(3, "0")}.png`;
      const { error: upErr } = await supabase.storage.from("doc_assets").upload(name, png, {
        contentType: "image/png",
        upsert: true,
      });
      if (upErr) {
        logWarn({ msg: "office_page_png_upload_failed", jobId, documentId, pageIndex, error: upErr.message });
      }
    } catch (e: any) {
      logWarn({ msg: "office_page_png_render_failed", jobId, documentId, pageIndex, error: e?.message || String(e) });
    }
  }
}

function looksLikeTableText(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 80) return false;
  const pipes = (t.match(/\|/g) || []).length;
  const tabs = (t.match(/\t/g) || []).length;
  // Very lightweight heuristics; real table structure comes from DI providers.
  return pipes >= 8 || tabs >= 6;
}

type ProcessingJobRow = {
  id: string;
  document_id: string | null;
  job_type: string;
  payload: any;
  attempts: number;
  max_attempts: number;
};

export async function processExtractTextJob(params: {
  supabase: SupabaseClient;
  bucket: string;
  job: ProcessingJobRow;
  ocrServiceUrl?: string;
  signedUrlSeconds: number;
  batchSize: number;
  documentIntelligenceUrl?: string;
}): Promise<{ totalTextLength: number; pageCount: number; coverageRatio: number; chunksWritten: number }>{
  const { supabase, job, bucket } = params;
  const documentId = job.document_id;
  if (!documentId) {
    throw new Error("extract_text job missing document_id");
  }

  async function extractViaDocumentIntelligence(): Promise<{
    pageCount: number;
    totalTextLength: number;
    confidence: number;
    blocksByPage: Map<number, Array<{ text: string; type?: string; confidence?: number }>>;
    canonical: any;
  } | null> {
    const baseUrl = (params.documentIntelligenceUrl || "").trim().replace(/\/+$/, "");
    if (!baseUrl) return null;

    // Only use DI for formats it knows well.
    const mt = String(mimeType || "").toLowerCase();
    const looksOffice =
      mt.includes("powerpoint") ||
      mt.includes("presentation") ||
      mt.includes("word") ||
      mt.includes("officedocument") ||
      mt.includes("msword") ||
      mt.includes("application/vnd");

    if (!looksOffice) return null;

    // Provide a filename hint so DI can detect file type reliably.
    let fileName = "document";
    if (mt.includes("powerpoint") || mt.includes("presentation") || mt.includes("ppt")) fileName = "document.pptx";
    else if (mt.includes("word") || mt.includes("doc")) fileName = "document.docx";

    const url = `${baseUrl}/extract`;
    const signedUrl = String(signed?.signedUrl || "");
    if (!signedUrl) return null;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signedUrl,
        fileName,
        mimeType,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logWarn({ msg: "doc_intelligence_extract_failed", jobId: job.id, documentId: documentId || undefined, status: resp.status, body: text.slice(0, 500) });
      return null;
    }

    const json: any = await resp.json().catch(() => null);
    if (!json?.success || !json?.canonical) {
      logWarn({ msg: "doc_intelligence_extract_invalid", jobId: job.id, documentId: documentId || undefined });
      return null;
    }

    const canonical = json.canonical;
    const pageCount = Number(canonical?.structure?.page_count ?? 0) || 1;
    const confidence = Number(canonical?.extraction?.confidence ?? json?.metadata?.confidence ?? 0.7) || 0.7;
    const fullText = String(canonical?.content?.full_text || "");
    const totalTextLength = fullText.length;

    const blocksByPage = new Map<number, Array<{ text: string; type?: string; confidence?: number }>>();
    const textBlocks = Array.isArray(canonical?.content?.text_blocks) ? canonical.content.text_blocks : [];
    for (const b of textBlocks) {
      const page = Number(b?.page ?? 1);
      const text = String(b?.text || "").trim();
      if (!text) continue;
      const type = b?.type ? String(b.type) : undefined;
      const conf = Number(b?.confidence);
      const arr = blocksByPage.get(page) || [];
      arr.push({ text, type, confidence: Number.isFinite(conf) ? conf : undefined });
      blocksByPage.set(page, arr);
    }

    return { pageCount, totalTextLength, confidence, blocksByPage, canonical };
  }

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id,storage_path,file_type,file_size")
    .eq("id", documentId)
    .single();

  if (docErr || !doc) {
    throw new Error(`Failed to load document: ${docErr?.message || "unknown"}`);
  }

  if (!doc.storage_path) {
    throw new Error("Document missing storage_path");
  }

  const mimeType = doc.file_type || job.payload?.mimeType || "application/octet-stream";
  const fileSize = doc.file_size || job.payload?.fileSize || 0;

  const { data: signed, error: signErr } = await supabase
    .storage
    .from(bucket)
    .createSignedUrl(doc.storage_path, params.signedUrlSeconds);

  if (signErr || !signed?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signErr?.message || "unknown"}`);
  }

  const resp = await fetch(signed.signedUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download document: ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const detectImageType = (): { ext: "png" | "jpg" | "webp" | null; mime: string | null } => {
    const mt = String(mimeType || "").toLowerCase();
    if (mt.startsWith("image/png")) return { ext: "png", mime: "image/png" };
    if (mt.startsWith("image/jpeg") || mt.startsWith("image/jpg")) return { ext: "jpg", mime: "image/jpeg" };
    if (mt.startsWith("image/webp")) return { ext: "webp", mime: "image/webp" };

    // Magic bytes
    if (bytes.length >= 8) {
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      ) {
        return { ext: "png", mime: "image/png" };
      }
    }

    if (bytes.length >= 3) {
      // JPEG: FF D8 FF
      if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { ext: "jpg", mime: "image/jpeg" };
      }
    }

    if (bytes.length >= 12) {
      // WEBP: RIFF....WEBP
      const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
      const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
      if (riff && webp) return { ext: "webp", mime: "image/webp" };
    }

    return { ext: null, mime: null };
  };

  const isPdfByMagic = (() => {
    // Detect PDF by file signature to handle cases where storage_path has no extension
    // and file_type may be missing/incorrect.
    // PDF files start with "%PDF-".
    if (bytes.length < 5) return false;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  })();

  // Only PDFs get page-level processing right now.
  // Prefer magic-byte detection so PDFs without a .pdf extension still work.
  const isPdf = isPdfByMagic || /pdf/i.test(mimeType) || doc.storage_path.toLowerCase().endsWith(".pdf");
  const imageType = detectImageType();
  const isImage = !!imageType.ext;

  if (!isPdf) {
    // Try Document Intelligence for PPTX/DOCX and other Office docs.
    const di = await extractViaDocumentIntelligence();
    if (di) {
      const pageCount = Math.max(1, di.pageCount);
      await upsertPagePreflight(supabase, documentId, pageCount);

      // Build per-page blocks.
      const pageBBox = { x: 0, y: 0, w: 1, h: 1 };
      const blockRows: any[] = [];
      let donePages = 0;

      for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
        const items = di.blocksByPage.get(pageIndex) || [];
        const pageText = items.map((i) => i.text).join("\n\n").trim();
        const hasText = pageText.length > 0;

        await updatePage(supabase, documentId, pageIndex, {
          status: "done",
          kind: hasText ? "text" : "blank",
          method: "doc_ai",
          confidence: Math.max(0.5, Math.min(0.95, di.confidence || 0.8)),
          text_length: pageText.length,
          error: null,
        });
        donePages += 1;

        // Emit at least one paragraph block so the UI has something to render.
        let nextBlockIndex = 1;
        if (hasText) {
          // Preserve block types where possible (table vs paragraph).
          for (const it of items) {
            const t = String(it.text || "").trim();
            if (!t) continue;
            const hintedType = String(it.type || "").toLowerCase();
            const blockType = hintedType.includes("table") ? "table" : "paragraph";
            blockRows.push({
              document_id: documentId,
              page_index: pageIndex,
              block_index: nextBlockIndex++,
              block_type: blockType,
              bbox: pageBBox,
              text: t,
              data: { source: "document_intelligence", hinted_type: it.type || null },
              confidence: Math.max(0, Math.min(1, it.confidence ?? di.confidence ?? 0.8)),
              status: blockType === "table" ? "detected" : "extracted",
            });
          }
        } else {
          blockRows.push({
            document_id: documentId,
            page_index: pageIndex,
            block_index: nextBlockIndex++,
            block_type: "paragraph",
            bbox: pageBBox,
            text: "",
            data: { note: "no_text_extracted", source: "document_intelligence" },
            confidence: 0.1,
            status: "missing",
          });
        }
      }

      // For PPTX specifically, generate per-slide preview images.
      // Deep Explain UI expects page images at doc_assets/{documentId}/page_XXX.png.
      const mt = String(mimeType || "").toLowerCase();
      const isPptx = mt.includes("powerpoint") || mt.includes("presentation") || mt.includes("ppt");
      if (isPptx) {
        const slidePngs = await tryConvertPptxToPngSlides(bytes);
        // LibreOffice sometimes only outputs a single PNG for PPTX.
        // Only use this path if it clearly produced multiple slide images.
        if (slidePngs && slidePngs.length >= 2) {
          const limit = Math.max(1, Math.min(pageCount, slidePngs.length));
          for (let i = 0; i < limit; i++) {
            const pageIndex = i + 1;
            const name = `${documentId}/page_${String(pageIndex).padStart(3, "0")}.png`;
            const { error: upErr } = await supabase.storage.from("doc_assets").upload(name, slidePngs[i], {
              contentType: "image/png",
              upsert: true,
            });
            if (upErr) {
              logWarn({ msg: "office_page_png_upload_failed", jobId: job.id, documentId, pageIndex, error: upErr.message });
            }
          }
        } else {
          // Fallback: PPTX -> PDF -> PNG render.
          const pdfBytes = await tryConvertPptxToPdfBytes(bytes);
          if (!pdfBytes) {
            logWarn({ msg: "pptx_preview_generation_failed", jobId: job.id, documentId });
          } else {
            await renderPdfPreviewsToStorage({
              supabase,
              documentId,
              pdfBytes,
              targetPageCount: pageCount,
              jobId: job.id,
              scale: 1.25,
            });
          }
        }
      }

      // Replace existing blocks for the doc.
      const { error: delErr } = await supabase
        .from("document_page_blocks")
        .delete()
        .eq("document_id", documentId);
      if (delErr) {
        logWarn({ msg: "block_delete_failed", jobId: job.id, documentId, start: 1, end: pageCount, error: delErr.message });
      }

      if (blockRows.length > 0) {
        const { error: insErr } = await supabase
          .from("document_page_blocks")
          .insert(blockRows);
        if (insErr) {
          logWarn({ msg: "block_insert_failed", jobId: job.id, documentId, start: 1, end: pageCount, error: insErr.message });
        }
      }

      // Store a single chunk containing the canonical output for reuse.
      const { error: chunkErr } = await supabase
        .from("document_extraction_chunks")
        .upsert(
          {
            document_id: documentId,
            chunk_start_page: 1,
            chunk_end_page: pageCount,
            provider: "document_intelligence",
            content: {
              jobId: job.id,
              mimeType,
              canonical: di.canonical,
            },
            text_length: di.totalTextLength,
            confidence: Math.max(0.5, Math.min(0.95, di.confidence || 0.8)),
          },
          { onConflict: "document_id,chunk_start_page,chunk_end_page,provider" }
        );
      if (chunkErr) {
        logWarn({ msg: "chunk_upsert_failed", jobId: job.id, jobType: job.job_type, documentId, start: 1, end: pageCount, error: chunkErr.message });
      }

      const coverageRatio = pageCount > 0 ? donePages / pageCount : 0;
      const wordCount = estimateWordCount(di.totalTextLength);
      const extractionStatus = coverageRatio >= 0.95 ? "completed" : "completed_partial";

      await finalizeDocument(supabase, documentId, {
        pageCount,
        totalTextLength: di.totalTextLength,
        wordCount,
        extractionStatus,
        extractionMetadata: {
          jobId: job.id,
          note: "document_intelligence",
          coverageRatio,
          pageCount,
          mimeType,
        },
      });

      return { totalTextLength: di.totalTextLength, pageCount, coverageRatio, chunksWritten: chunkErr ? 0 : 1 };
    }

    // Support single-image documents (common on mobile uploads).
    if (isImage) {
      const pageIndex = 1;
      await upsertPagePreflight(supabase, documentId, 1);

      // Upload the original image as the page preview.
      let imagePath: string | null = null;
      try {
        const name = `${documentId}/page_${String(pageIndex).padStart(3, "0")}.${imageType.ext}`;
        const { error: upErr } = await supabase.storage.from("doc_assets").upload(name, Buffer.from(bytes), {
          contentType: imageType.mime || "application/octet-stream",
          upsert: true,
        });

        if (upErr) {
          logWarn({ msg: "page_image_upload_failed", jobId: job.id, documentId, pageIndex, error: upErr.message });
        } else {
          imagePath = `doc_assets/${name}`;
        }
      } catch (e: any) {
        logWarn({ msg: "page_image_upload_failed", jobId: job.id, documentId, pageIndex, error: e?.message || String(e) });
      }

      // Optional OCR for images.
      let ocrText: string | null = null;
      let ocrConfidence = 0.0;
      if (params.ocrServiceUrl) {
        const ocr = await runOcr({
          ocrServiceUrl: params.ocrServiceUrl,
          signedUrl: signed.signedUrl,
          mimeType: imageType.mime || mimeType,
          fileSize,
          documentId,
          pageStart: 1,
          pageEnd: 1,
        });
        if (ocr?.text) {
          ocrText = ocr.text;
          ocrConfidence = ocr.confidence;
        }
      }

      const pageBBox = { x: 0, y: 0, w: 1, h: 1 };
      const blockRows: any[] = [];
      let nextBlockIndex = 1;

      // Paragraph block for OCR (if any)
      if (ocrText) {
        const tableLike = looksLikeTableText(ocrText);
        blockRows.push({
          document_id: documentId,
          page_index: 1,
          block_index: nextBlockIndex++,
          block_type: tableLike ? "table" : "paragraph",
          bbox: pageBBox,
          text: ocrText,
          data: { source: "ocr" },
          confidence: Math.max(0, Math.min(1, ocrConfidence || 0.7)),
          status: tableLike ? "detected" : "extracted",
        });
      } else {
        // Placeholder paragraph to avoid empty blocks.
        blockRows.push({
          document_id: documentId,
          page_index: 1,
          block_index: nextBlockIndex++,
          block_type: "paragraph",
          bbox: pageBBox,
          text: "",
          data: { note: "no_text_extracted" },
          confidence: 0.1,
          status: "missing",
        });
      }

      // Figure block referencing the uploaded image.
      blockRows.push({
        document_id: documentId,
        page_index: 1,
        block_index: nextBlockIndex++,
        block_type: "figure",
        bbox: pageBBox,
        text: null,
        data: {
          image_path: imagePath,
          source: "uploaded_image",
        },
        confidence: 0.6,
        status: "vision_pending",
      });

      // Replace any existing blocks for this page.
      const { error: delErr } = await supabase
        .from("document_page_blocks")
        .delete()
        .eq("document_id", documentId)
        .eq("page_index", 1);

      if (delErr) {
        logWarn({ msg: "block_delete_failed", jobId: job.id, documentId, start: 1, end: 1, error: delErr.message });
      }

      const { error: insErr } = await supabase
        .from("document_page_blocks")
        .insert(blockRows);

      if (insErr) {
        logWarn({ msg: "block_insert_failed", jobId: job.id, documentId, start: 1, end: 1, error: insErr.message });
      }

      const textLength = ocrText ? ocrText.length : 0;

      // Mark the page as done even if OCR yields empty text; coverage should reflect processing, not content.
      await updatePage(supabase, documentId, 1, {
        status: "done",
        kind: "scanned",
        method: ocrText ? "ocr" : "fallback",
        confidence: ocrText ? Math.max(0.6, ocrConfidence || 0.7) : 0.4,
        text_length: textLength,
        error: null,
      });

      const totalTextLength = textLength;
      const coverageRatio = 1;
      const wordCount = estimateWordCount(totalTextLength);

      await finalizeDocument(supabase, documentId, {
        pageCount: 1,
        totalTextLength,
        wordCount,
        extractionStatus: "completed",
        extractionMetadata: {
          jobId: job.id,
          note: "image_supported",
          mimeType: imageType.mime || mimeType,
          hadOcrText: !!ocrText,
        },
      });

      return { totalTextLength, pageCount: 1, coverageRatio, chunksWritten: 0 };
    }

    // Minimal support: treat as single-page unknown.
    await upsertPagePreflight(supabase, documentId, 1);
    await updatePage(supabase, documentId, 1, {
      status: "failed",
      kind: "unknown",
      method: "fallback",
      confidence: 0.2,
      text_length: 0,
      error: `Unsupported mimeType for page-level extraction: ${mimeType}`,
    });

    await finalizeDocument(supabase, documentId, {
      pageCount: 1,
      totalTextLength: 0,
      wordCount: 0,
      extractionStatus: "failed",
      extractionMetadata: {
        jobId: job.id,
        note: "non_pdf_not_supported",
        mimeType,
      },
    });

    return { totalTextLength: 0, pageCount: 1, coverageRatio: 0, chunksWritten: 0 };
  }

  const pdf = await loadPdf(bytes);
  const pageCount = await getPdfPageCount(pdf);

  logInfo({ msg: "pdf_loaded", jobId: job.id, jobType: job.job_type, documentId, pageCount });

  await upsertPagePreflight(supabase, documentId, pageCount);

  let totalTextLength = 0;
  let donePages = 0;
  let chunksWritten = 0;

  for (let start = 1; start <= pageCount; start += params.batchSize) {
    const end = Math.min(pageCount, start + params.batchSize - 1);
    const pages: any[] = [];
    const blockRows: any[] = [];

    // Optional batch OCR fallback (intended to cover scanned/poor pages)
    let batchOcrText: string | null = null;
    let batchOcrUsed = false;
    if (params.ocrServiceUrl) {
      const ocr = await runOcr({
        ocrServiceUrl: params.ocrServiceUrl,
        signedUrl: signed.signedUrl,
        mimeType,
        fileSize,
        documentId,
        pageStart: start,
        pageEnd: end,
      });
      if (ocr?.text) batchOcrText = ocr.text;
    }

    for (let pageIndex = start; pageIndex <= end; pageIndex++) {
      await updatePage(supabase, documentId, pageIndex, { status: "processing" });

      let pageText = "";
      let method: "pdf_text" | "ocr" | "fallback" = "pdf_text";
      let confidence = 0.6;

      const inventory = await detectPdfPageInventory(pdf, pageIndex);
      const textRes = await extractPdfPageText(pdf, pageIndex);

      pageText = textRes.text;
      confidence = textRes.confidence;

      const seemsBlank = textRes.textLength === 0;
      const seemsScanned = seemsBlank && inventory.hasImages;
      const poor = textRes.isPoor || seemsScanned;

      let kind: "text" | "scanned" | "blank" | "unknown" = "unknown";
      if (textRes.textLength > 0) kind = "text";
      else if (seemsScanned) kind = "scanned";
      else if (seemsBlank) kind = "blank";

      if (poor) {
        // Use batch OCR output if available.
        // Note: we do NOT assign the batch text to every page to avoid duplicating content.
        if (batchOcrText) {
          method = "ocr";
          confidence = Math.max(confidence, 0.7);
          if (kind === "blank") kind = "scanned";
          batchOcrUsed = true;

          // If this batch is a single page, attach OCR text to that page so the app
          // has something to show/explain.
          if (start === end) {
            pageText = batchOcrText;
          }
        } else {
          method = "fallback";
          confidence = Math.min(confidence, 0.4);
        }
      }

      const textLength = pageText.length;
      totalTextLength += textLength;

      const status = textLength > 0 || kind === "blank" || (batchOcrText && kind === "scanned") ? "done" : "failed";
      if (status === "done") donePages += 1;

      await updatePage(supabase, documentId, pageIndex, {
        status,
        kind,
        method,
        confidence,
        text_length: textLength,
        error: status === "failed" ? "no_text_extracted" : null,
      });

      // --- Block inventory ---
      // Ensure the app always has per-page artifacts to render:
      // - a paragraph/table block if we have text
      // - a figure block with a rendered PNG for preview (even if the page has no embedded images)
      const pageBBox = { x: 0, y: 0, w: 1, h: 1 };
      let nextBlockIndex = 1;

      if (pageText && pageText.trim().length > 0) {
        const tableLike = looksLikeTableText(pageText);
        blockRows.push({
          document_id: documentId,
          page_index: pageIndex,
          block_index: nextBlockIndex++,
          block_type: tableLike ? "table" : "paragraph",
          bbox: pageBBox,
          text: pageText,
          data: null,
          confidence: Math.max(0, Math.min(1, confidence ?? 0.5)),
          status: tableLike ? "detected" : "extracted",
        });
      }

      // Always attempt to render a preview image.
      // Deep Explain UI expects a page image even for text-only pages.
      let imagePath: string | null = null;
      try {
        const png = await renderPdfPageToPng(pdf, pageIndex, { scale: 2 });
        const name = `${documentId}/page_${String(pageIndex).padStart(3, "0")}.png`;
        const { error: upErr } = await supabase.storage.from("doc_assets").upload(name, png, {
          contentType: "image/png",
          upsert: true,
        });
        if (upErr) {
          logWarn({ msg: "page_png_upload_failed", jobId: job.id, documentId, pageIndex, error: upErr.message });
        } else {
          imagePath = `doc_assets/${name}`;
        }
      } catch (e: any) {
        logWarn({ msg: "page_png_render_failed", jobId: job.id, documentId, pageIndex, error: e?.message || String(e) });
      }

      blockRows.push({
        document_id: documentId,
        page_index: pageIndex,
        block_index: nextBlockIndex++,
        block_type: "figure",
        bbox: pageBBox,
        text: null,
        data: {
          image_path: imagePath,
          image_ops_count: inventory?.imageOpsCount ?? null,
          has_images: inventory?.hasImages ?? null,
          source: "pdf_render",
        },
        confidence: 0.5,
        // Only mark as vision_pending when the page appears scanned/poor so we don't
        // unnecessarily invoke vision on clean text pages.
        status: kind === "scanned" ? "vision_pending" : "extracted",
      });

      // If we still have no text, emit a placeholder paragraph block so page-level
      // queries don't return an empty set of blocks.
      if (!pageText || pageText.trim().length === 0) {
        blockRows.push({
          document_id: documentId,
          page_index: pageIndex,
          block_index: nextBlockIndex++,
          block_type: "paragraph",
          bbox: pageBBox,
          text: "",
          data: { note: "no_text_extracted" },
          confidence: 0.1,
          status: "missing",
        });
      }

      pages.push({
        pageIndex,
        kind,
        method,
        confidence,
        textLength,
        text: pageText,
        blocks: {
          inventory,
        },
      });
    }

    // If we extracted OCR text for this batch, count it once at the chunk level.
    // This keeps totalTextLength/has_text meaningful without duplicating OCR text per page.
    if (batchOcrText && batchOcrUsed) {
      totalTextLength += batchOcrText.length;
    }

    // Replace existing blocks for this page range, then insert new inventory.
    if (blockRows.length > 0) {
      const { error: delErr } = await supabase
        .from("document_page_blocks")
        .delete()
        .eq("document_id", documentId)
        .gte("page_index", start)
        .lte("page_index", end);

      if (delErr) {
        logWarn({ msg: "block_delete_failed", jobId: job.id, documentId, start, end, error: delErr.message });
      }

      const { error: insErr } = await supabase
        .from("document_page_blocks")
        .insert(blockRows);

      if (insErr) {
        logWarn({ msg: "block_insert_failed", jobId: job.id, documentId, start, end, error: insErr.message });
      }
    }

    const chunkTextLength = pages.reduce((sum, p) => sum + (p.textLength || 0), 0) + (batchOcrText && batchOcrUsed ? batchOcrText.length : 0);
    const chunkConfidence = pages.length ? pages.reduce((sum, p) => sum + (p.confidence || 0), 0) / pages.length : null;

    const { error: chunkErr } = await supabase
      .from("document_extraction_chunks")
      .upsert(
        {
          document_id: documentId,
          chunk_start_page: start,
          chunk_end_page: end,
          provider: "fallback",
          content: {
            jobId: job.id,
            mimeType,
            pages,
            ocr: batchOcrText && batchOcrUsed ? { text: batchOcrText, pageStart: start, pageEnd: end } : null,
          },
          text_length: chunkTextLength,
          confidence: chunkConfidence,
        },
        { onConflict: "document_id,chunk_start_page,chunk_end_page,provider" }
      );

    if (chunkErr) {
      logWarn({ msg: "chunk_upsert_failed", jobId: job.id, jobType: job.job_type, documentId, start, end, error: chunkErr.message });
    } else {
      chunksWritten += 1;
    }
  }

  const coverageRatio = pageCount > 0 ? donePages / pageCount : 0;
  const wordCount = estimateWordCount(totalTextLength);

  const extractionStatus = coverageRatio >= 0.95 ? "completed" : "completed_partial";

  await finalizeDocument(supabase, documentId, {
    pageCount,
    totalTextLength,
    wordCount,
    extractionStatus,
    extractionMetadata: {
      jobId: job.id,
      coverageRatio,
      chunksWritten,
      pageCount,
      mimeType,
    },
  });

  return { totalTextLength, pageCount, coverageRatio, chunksWritten };
}

function estimateWordCount(textLength: number): number {
  // Rough heuristic: average English-ish word length ~5 + space.
  if (textLength <= 0) return 0;
  return Math.max(1, Math.round(textLength / 6));
}

async function upsertPagePreflight(supabase: SupabaseClient, documentId: string, pageCount: number) {
  const rows = Array.from({ length: pageCount }, (_, idx) => ({
    document_id: documentId,
    page_index: idx + 1,
    status: "pending",
    kind: "unknown",
  }));

  const { error } = await supabase
    .from("document_pages")
    .upsert(rows, { onConflict: "document_id,page_index" });

  if (error) {
    throw new Error(`Failed to preflight document_pages: ${error.message}`);
  }
}

async function updatePage(
  supabase: SupabaseClient,
  documentId: string,
  pageIndex: number,
  fields: Record<string, any>
) {
  const { error } = await supabase
    .from("document_pages")
    .update(fields)
    .eq("document_id", documentId)
    .eq("page_index", pageIndex);

  if (error) {
    throw new Error(`Failed to update document_pages(${pageIndex}): ${error.message}`);
  }
}

async function finalizeDocument(
  supabase: SupabaseClient,
  documentId: string,
  params: {
    pageCount: number;
    totalTextLength: number;
    wordCount: number;
    extractionStatus: "completed" | "completed_partial" | "failed";
    extractionMetadata: Record<string, any>;
  }
) {
  const hasText = params.totalTextLength > 0;
  const { error } = await supabase
    .from("documents")
    .update({
      has_text: hasText,
      text_length: params.totalTextLength,
      word_count: params.wordCount,
      page_count: params.pageCount,
      extraction_metadata: params.extractionMetadata,
      extracted_at: new Date().toISOString(),
      extraction_status: params.extractionStatus,
    })
    .eq("id", documentId);

  if (error) {
    throw new Error(`Failed to update documents: ${error.message}`);
  }
}
