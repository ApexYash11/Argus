import fs from "fs";
import { PDFParse } from "pdf-parse";

let tesseractWorker: any = null;

async function getTesseractWorker() {
  if (!tesseractWorker) {
    const { createWorker } = await import("tesseract.js");
    tesseractWorker = await createWorker("eng");
  }
  return tesseractWorker;
}

export interface PdfExtractResult {
  text: string;
  pages: number;
  method: "text" | "ocr";
  error?: string;
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function extractPdf(filePath: string): Promise<PdfExtractResult> {
  if (!fs.existsSync(filePath)) {
    return { text: "", pages: 0, method: "text", error: "File not found" };
  }

  const buffer = fs.readFileSync(filePath);

  try {
    const p = new PDFParse(bufferToArrayBuffer(buffer));
    await p.load();
    const result = await p.getText();
    const text = (result.text ?? "").trim();
    if (text.length > 20) {
      return { text, pages: result.total ?? 1, method: "text" };
    }
  } catch {
    // text extraction failed, fall through to OCR
  }

  try {
    const worker = await getTesseractWorker();
    const { data } = await worker.recognize(buffer);
    return { text: data.text ?? "", pages: 1, method: "ocr" };
  } catch (err: any) {
    return { text: "", pages: 0, method: "ocr", error: `OCR failed: ${err.message}` };
  }
}

export async function extractInvoiceFields(
  filePath: string
): Promise<{ vendorName?: string; invoiceNumber?: string; amount?: number; date?: string; lineItems?: string[] }> {
  const { text, method, error } = await extractPdf(filePath);
  if (error || !text) return {};

  const vendorMatch = text.match(/(?:vendor|from|supplier)[:\s]+(.+)/i);
  const invMatch = text.match(/(?:invoice\s*(?:no|#|number)|inv[:\s]*(?:no|#)?)[:\s]*([\w-/]+)/i);
  const amountMatch = text.match(/(?:total|amount\s*due|grand\s*total)[:\s]*[₹$€]?\s*([\d,]+\.?\d*)/i);
  const dateMatch = text.match(/(?:date|invoice\s*date)[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);

  return {
    vendorName: vendorMatch?.[1]?.trim(),
    invoiceNumber: invMatch?.[1]?.trim(),
    amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : undefined,
    date: dateMatch?.[1],
    lineItems: text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20),
  };
}
