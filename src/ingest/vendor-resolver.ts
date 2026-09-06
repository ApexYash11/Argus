import crypto from "crypto";
import { getAllVendors, upsertVendor } from "../db/queries";
import type { Vendor } from "../model/types";

const SEED_VENDORS: Array<{ name: string; aliases: string[] }> = [
  { name: "AWS India Pvt Ltd", aliases: ["AWS", "Amazon Web Services", "Amazon AWS", "AWSI", "Amazon Web Services India Pvt Ltd"] },
  { name: "Google Cloud India", aliases: ["Google Cloud", "GCP", "Google Cloud Platform"] },
  { name: "Slack Technologies", aliases: ["Slack", "Slack Corp"] },
  { name: "Razorpay Payments Pvt Ltd", aliases: ["Razorpay", "Razorpay Payments"] },
  { name: "Zoho Corporation", aliases: ["Zoho", "Zoho Corp"] },
  { name: "Freshworks Inc", aliases: ["Freshworks", "Freshworks Inc."] },
  { name: "Microsoft India", aliases: ["Microsoft", "MS", "Microsoft Corp"] },
  { name: "DigitalOcean Inc", aliases: ["DigitalOcean", "DO"] },
  { name: "Cloudflare Inc", aliases: ["Cloudflare", "CF"] },
  { name: "HubSpot India", aliases: ["HubSpot", "HubSpot Inc"] },
  { name: "Facebook India", aliases: ["Facebook", "Meta", "Meta Platforms"] },
  { name: "Google Ads India", aliases: ["Google Ads", "Google Adwords"] },
  { name: "LinkedIn India", aliases: ["LinkedIn", "LinkedIn Corp"] },
  { name: "Figma Inc", aliases: ["Figma", "Figma Corp"] },
  { name: "Notion Labs Inc", aliases: ["Notion", "Notion Labs"] },
  { name: "Atlassian Pty Ltd", aliases: ["Atlassian", "Jira", "Confluence"] },
  { name: "GitHub Inc", aliases: ["GitHub", "Github"] },
  { name: "Datadog Inc", aliases: ["Datadog", "DataDog"] },
  { name: "Intercom Inc", aliases: ["Intercom", "Intercom Inc."] },
  { name: "Salesforce India", aliases: ["Salesforce", "SFDC"] },
  { name: "Mailchimp", aliases: ["Mailchimp", "MailChimp", "Intuit Mailchimp"] },
  { name: "Asana Inc", aliases: ["Asana", "Asana Corp"] },
  { name: "Loom Inc", aliases: ["Loom", "Loom Corp"] },
  { name: "Calendly Inc", aliases: ["Calendly", "Calendly Corp"] },
  { name: "PagerDuty Inc", aliases: ["PagerDuty", "Pager Duty"] },
  { name: "Zoom Video Communications", aliases: ["Zoom", "Zoom Communications"] },
];

const seeded = new Set<string>();

// In-memory vendor cache: resolveVendor() is called per row, and each call
// used to do 2 full-table scans + upserts (~100 rows/s on large files).
// Cache is refreshed explicitly per ingest file (see clearVendorCache).
let vendorCache: Vendor[] | null = null;

export function clearVendorCache(): void {
  vendorCache = null;
  resolutionCache.clear();
}

// Memoize per raw name: repeated vendor names (the common case) skip the
// full dice scan entirely. Cleared together with the vendor cache.
const resolutionCache = new Map<string, { vendorId: string; canonicalName: string; confidence: number; method: "seed" | "fuzzy" | "llm" | "new" }>();

function allCached(): Vendor[] {
  if (!vendorCache) vendorCache = getAllVendors();
  return vendorCache;
}

function cacheUpsert(v: Vendor): void {
  if (!vendorCache) return;
  const idx = vendorCache.findIndex((x) => x.id === v.id);
  if (idx >= 0) vendorCache[idx] = v;
  else vendorCache.push(v);
}

function seedVendorId(name: string): string {
  const hash = crypto.createHash("sha256").update(name).digest("hex").slice(0, 6).toUpperCase();
  return `VND-${hash}`;
}

function seedVendors(): void {
  const existing = allCached();
  const existingNames = new Set(existing.map((v) => v.canonicalName.toLowerCase()));
  const existingAliases = new Set(existing.flatMap((v) => v.aliases.map((a) => a.toLowerCase())));

  for (const v of SEED_VENDORS) {
    const id = seedVendorId(v.name);
    if (seeded.has(id)) continue;
    seeded.add(id);

    if (existingNames.has(v.name.toLowerCase())) continue;
    const hasAnyAlias = v.aliases.some((a) => existingAliases.has(a.toLowerCase()));
    if (hasAnyAlias) continue;

    upsertVendor({
      id,
      canonicalName: v.name,
      aliases: [v.name, ...v.aliases],
      trustScore: 1.0,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
    cacheUpsert({
      id,
      canonicalName: v.name,
      aliases: [v.name, ...v.aliases],
      trustScore: 1.0,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
  }
}

export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.slice(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.slice(i, i + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count > 0) {
      bigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (a.length - 1 + b.length - 1);
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(pvt|ltd|inc|corp|llc|private|limited|technologies|technology|solutions|services|india|ind|pvt\.)\b/g, "")
    .trim();
}

export function resolveVendor(rawName: string): { vendorId: string; canonicalName: string; confidence: number; method: "seed" | "fuzzy" | "llm" | "new" } {
  const memo = resolutionCache.get(rawName);
  if (memo) return memo;
  const resolved = resolveVendorUncached(rawName);
  resolutionCache.set(rawName, resolved);
  return resolved;
}

function resolveVendorUncached(rawName: string): { vendorId: string; canonicalName: string; confidence: number; method: "seed" | "fuzzy" | "llm" | "new" } {
  seedVendors();
  const vendors = allCached();
  const normalized = normalizeName(rawName);

  for (const v of vendors) {
    for (const alias of v.aliases) {
      if (alias.toLowerCase() === rawName.toLowerCase()) {
        return { vendorId: v.id, canonicalName: v.canonicalName, confidence: 1.0, method: "seed" };
      }
    }
  }

  let bestScore = 0;
  let bestVendor: Vendor | null = null;
  for (const v of vendors) {
    const vNorm = normalizeName(v.canonicalName);
    for (const alias of v.aliases) {
      const score = diceCoefficient(normalized, normalizeName(alias));
      if (score > bestScore) {
        bestScore = score;
        bestVendor = v;
      }
    }
    const score = diceCoefficient(normalized, vNorm);
    if (score > bestScore) {
      bestScore = score;
      bestVendor = v;
    }
  }

  if (bestScore >= 0.6 && bestVendor) {
    if (bestScore >= 0.85 && rawName.length > 2) {
      const updated: Vendor = {
        ...bestVendor,
        aliases: [...new Set([...bestVendor.aliases, rawName])],
        lastSeen: new Date().toISOString(),
      };
      upsertVendor(updated);
      cacheUpsert(updated);
    }
    return { vendorId: bestVendor.id, canonicalName: bestVendor.canonicalName, confidence: Math.round(bestScore * 100) / 100, method: "fuzzy" };
  }

  const newId = seedVendorId(rawName);
  const newVendor: Vendor = {
    id: newId,
    canonicalName: rawName,
    aliases: [rawName],
    trustScore: 0.5,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  upsertVendor(newVendor);
  cacheUpsert(newVendor);
  return { vendorId: newId, canonicalName: rawName, confidence: 0.5, method: "new" };
}
