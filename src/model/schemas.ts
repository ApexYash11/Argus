import { z } from "zod";

export const FinancialRecordSchema = z.object({
  id: z.string(),
  type: z.enum(["invoice", "payment", "subscription", "expense", "commitment"]),
  vendorId: z.string(),
  amount: z.number(),
  currency: z.string(),
  date: z.string(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["cleared", "pending", "cancelled"]),
  sourceDocId: z.string().optional(),
  raw: z.string(),
  ingestedAt: z.string(),
});

export const SubscriptionRowSchema = z.object({
  vendor: z.string(),
  monthly_amount: z.coerce.number(),
  seat_count: z.coerce.number(),
  renewal_date: z.string(),
});

export const UsageRowSchema = z.object({
  employee_email: z.string().email(),
  tool: z.string(),
  last_login: z.string(),
});

export const TransactionRowSchema = z.object({
  date: z.string(),
  vendor_name: z.string(),
  amount: z.coerce.number(),
  reference: z.string().optional(),
  cleared: z.enum(["yes", "no", "true", "false", "1", "0"]).transform((v) => ["yes", "true", "1"].includes(v.toLowerCase())),
});

export const ExpenseReportRowSchema = z.object({
  employee: z.string(),
  date: z.string(),
  category: z.string(),
  amount: z.coerce.number(),
  has_receipt: z.enum(["yes", "no", "true", "false"]).transform((v) => ["yes", "true"].includes(v.toLowerCase())),
});

export const CommittedExpenseRowSchema = z.object({
  vendor: z.string(),
  amount: z.coerce.number(),
  due_date: z.string(),
  description: z.string().optional(),
});

export const ConfigSchema = z.object({
  company: z.string().min(1),
  currency: z.string().length(3).default("INR"),
  minRunwayMonths: z.number().min(1).max(24).default(8),
  minOperatingReserve: z.number().min(0).default(0),
  maxIterations: z.number().min(1).max(10).default(5),
  confidenceFloor: z.number().min(0).max(1).default(0.7),
  scratchpad: z.object({
    retentionCount: z.number().min(1).max(365).default(30),
  }).default({ retentionCount: 30 }),
  policy: z.object({
    maxExpenseWithoutReceipt: z.number().positive().optional(),
    perCategoryLimits: z.record(z.string(), z.number().positive()).optional(),
    prohibitedCategories: z.array(z.string()).optional(),
    submissionWindowDays: z.number().positive().optional(),
    preApprovalThreshold: z.number().positive().optional(),
    perDiemLimits: z.record(z.string(), z.number().positive()).optional(),
  }).optional(),
});

export type ConfigInput = z.input<typeof ConfigSchema>;
export type ConfigOutput = z.output<typeof ConfigSchema>;
