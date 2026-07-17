export function getYearMonth(dateStr: string): string {
  if (!dateStr || dateStr.length < 7) return "unknown";
  if (/^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0, 7);
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 7);
  return "unknown";
}

export function normalizeDateForDisplay(dateStr: string): string {
  const today = new Date().toISOString().split("T")[0] ?? "";
  if (!dateStr) return today;
  const trimmed = dateStr.trim();
  const iso = new Date(trimmed);
  if (!isNaN(iso.getTime())) return iso.toISOString().split("T")[0] ?? today;
  return today;
}
