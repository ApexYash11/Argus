import { getFindings } from "../../db/queries";

export async function generateReport(period?: string) {
  const findings = getFindings();
  const openFindings = findings.filter((f) => f.status === "open");
  const criticalFindings = findings.filter((f) => f.severity === "critical");
  const totalImpact = findings.reduce((sum, f) => sum + (f.impactAmount ?? 0), 0);

  return {
    period: period ?? "all-time",
    summary: {
      total: findings.length,
      open: openFindings.length,
      critical: criticalFindings.length,
      resolved: findings.filter((f) => f.status === "resolved").length,
      dismissed: findings.filter((f) => f.status === "dismissed").length,
      totalImpact,
    },
    findings,
  };
}
