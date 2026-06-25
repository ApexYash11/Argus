import { extractPdf } from "./pdf-extractor";
import { getDb } from "../db/index";
import type { ContractTerms } from "../model/types";

export async function extractContractTerms(
  vendorId: string,
  filePath: string
): Promise<ContractTerms | null> {
  const db = getDb();
  const existing = db.query("SELECT * FROM contract_terms WHERE vendor_id = $vendorId").get({ $vendorId: vendorId }) as Record<string, unknown> | undefined;
  if (existing) {
    return rowToContractTerms(existing);
  }

  const { text, error } = await extractPdf(filePath);
  if (error || !text) return null;

  const basePrice = extractAmount(text, /(?:base\s*price|monthly\s*fee|annual\s*fee|subscription\s*fee)[:\s]*[₹$€]?\s*([\d,]+\.?\d*)/i);
  const freqMatch = text.match(/(?:billing\s*frequency|billed)\s*[:;]\s*(monthly|quarterly|yearly|annual|month)/i);
  const escalationMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:annual\s*)?escal/i);

  const terms: ContractTerms = {
    vendorId,
    basePrice: basePrice ?? 0,
    billingFrequency: freqMatch?.[1]?.toLowerCase().startsWith("month") ? "monthly"
      : freqMatch?.[1]?.toLowerCase().startsWith("quarter") ? "quarterly"
      : freqMatch?.[1]?.toLowerCase().startsWith("year") || freqMatch?.[1]?.toLowerCase().startsWith("annual") ? "yearly"
      : "monthly",
    escalationClause: escalationMatch ? parseFloat(escalationMatch[1]) : undefined,
    extractedFrom: filePath,
    extractedAt: new Date().toISOString(),
  };

  db.run(
    `INSERT OR REPLACE INTO contract_terms (vendor_id, base_price, billing_frequency, escalation_clause, extracted_from, extracted_at)
     VALUES ($vendorId, $basePrice, $freq, $escalation, $from, $at)`,
    {
      $vendorId: vendorId,
      $basePrice: terms.basePrice,
      $freq: terms.billingFrequency,
      $escalation: terms.escalationClause ?? null,
      $from: terms.extractedFrom,
      $at: terms.extractedAt,
    }
  );

  return terms;
}

function extractAmount(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

function rowToContractTerms(row: Record<string, unknown>): ContractTerms {
  return {
    vendorId: row.vendor_id as string,
    basePrice: row.base_price as number,
    billingFrequency: row.billing_frequency as ContractTerms["billingFrequency"],
    escalationClause: (row.escalation_clause as number | null) ?? undefined,
    extractedFrom: row.extracted_from as string,
    extractedAt: row.extracted_at as string,
  };
}
