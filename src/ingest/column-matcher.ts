const MATCH_SCORE = {
  EXACT: 100,
  SEMANTIC: 90,
  WORD: 70,
  PREFIX_SUFFIX: 40,
  SUBSTRING: 10,
} as const;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
}

function scoreHeader(header: string, kwNorm: string): number {
  const headerNorm = normalize(header);

  if (headerNorm === kwNorm) return MATCH_SCORE.EXACT;

  const tokens = tokenize(header);
  if (tokens.length > 1) {
    if (tokens[0] === kwNorm) return MATCH_SCORE.SEMANTIC;
    if (tokens.slice(1).includes(kwNorm)) return MATCH_SCORE.WORD;
  }

  const originalLower = header.toLowerCase();
  if (headerNorm.startsWith(kwNorm)) {
    const afterKw = originalLower[kwNorm.length];
    if (afterKw && /[^a-z0-9]/.test(afterKw)) return MATCH_SCORE.PREFIX_SUFFIX;
  }
  if (headerNorm.endsWith(kwNorm)) {
    const beforeKw = originalLower[originalLower.length - kwNorm.length - 1];
    if (beforeKw && /[^a-z0-9]/.test(beforeKw)) return MATCH_SCORE.PREFIX_SUFFIX;
  }

  if (headerNorm.includes(kwNorm)) return MATCH_SCORE.SUBSTRING;

  return 0;
}

function matchColumn(headers: string[], keywords: string[]): string | null {
  let bestHeader: string | null = null;
  let bestScore = 0;
  let bestKwIdx = Infinity;

  const kwNormalized = keywords.map(normalize);

  for (const header of headers) {
    for (let ki = 0; ki < kwNormalized.length; ki++) {
      const score = scoreHeader(header, kwNormalized[ki]!);
      if (score <= 0) continue; // never match on zero score (was: first header always won ties)
      if (score > bestScore || (score === bestScore && ki < bestKwIdx)) {
        bestScore = score;
        bestHeader = header;
        bestKwIdx = ki;
      }
    }
  }

  return bestHeader;
}

export { matchColumn, scoreHeader, normalize, MATCH_SCORE };
