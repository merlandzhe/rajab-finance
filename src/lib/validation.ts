import { z } from "zod";
const id = z.uuid();
const amount = z.string().regex(/^\d{1,12}$/);
const date = z.iso.date();
const text = z.string().trim().min(2).max(120);
const notes = z.string().max(2000).default("");
const url = z
  .union([
    z.literal(""),
    z
      .url()
      .max(1000)
      .refine((v) => v.startsWith("https://") || v.startsWith("http://")),
  ])
  .optional();
export const customerSchema = z
  .object({
    name: text,
    phone: z.string().regex(/^\+?[0-9 ()-]{7,24}$/),
    email: z.union([z.email(), z.literal("")]).optional(),
    notes,
  })
  .strict();
export const applicationSchema = z
  .object({
    customer_id: id,
    product_name: z.string().trim().min(2).max(160),
    product_url: url,
    supplier: z.string().max(160).default(""),
    estimated_cost: amount,
    down_payment: amount,
    months: z.number().int().min(1).max(36),
    notes,
  })
  .strict();
export const intakeSchema = applicationSchema
  .omit({ customer_id: true })
  .extend({
    name: text,
    phone: z.string().regex(/^\+?[0-9 ()-]{7,24}$/),
    email: z.union([z.email(), z.literal("")]).optional(),
    consent: z.literal(true),
    website: z.string().max(0),
    key: id,
  })
  .strict();
export const schemas = {
  "portal.directory": z
    .object({ display_name: text, enabled: z.boolean() })
    .strict(),
  "portal.clarify": z
    .object({ id, message: z.string().trim().min(2).max(2000) })
    .strict(),
  "portal.reply": z
    .object({ id, message: z.string().trim().min(2).max(2000) })
    .strict(),
  "portal.application": applicationSchema.omit({
    customer_id: true,
    supplier: true,
  }),
  "portal.claim": z
    .object({
      contract_id: id,
      amount,
      paid_on: date,
      method: z.enum(["sbp", "cash"]),
    })
    .strict(),
  "portal.confirm": z.object({ id, cash_account_id: id }).strict(),
  "portal.reject": z
    .object({ id, reason: z.string().trim().min(5).max(1000) })
    .strict(),
  "customer.create": customerSchema,
  "application.create": applicationSchema,
  "application.transition": z
    .object({
      id,
      status: z.enum(["review", "approved", "rejected", "awaiting_purchase"]),
    })
    .strict(),
  "purchase.record": z
    .object({
      id,
      supplier: z.string().trim().min(2).max(160),
      cost: amount,
      purchased_on: date,
      document_id: id,
      ownership_confirmed: z.literal(true),
    })
    .strict(),
  "quote.confirm": z
    .object({
      id,
      months: z.number().int().min(1).max(36),
      down_payment: amount,
      first_payment_on: date,
      agreed: z.literal(true),
      custom_kind: z.enum(["rubles", "percent"]).optional(),
      custom_value: amount.optional(),
    })
    .strict(),
  "contract.create": z.object({ id }).strict(),
  "contract.transfer": z
    .object({
      id,
      transferred_on: date,
      reference: z.string().trim().min(3).max(1000),
    })
    .strict(),
  "payment.record": z
    .object({ contract_id: id, cash_account_id: id, amount, paid_on: date })
    .strict(),
  "payment.reverse": z
    .object({ id, reason: z.string().trim().min(5).max(1000) })
    .strict(),
  "cash.create": z.object({ name: z.string().trim().min(2).max(80) }).strict(),
  "cash.move": z
    .object({
      cash_account_id: id,
      destination_id: id.optional(),
      kind: z.enum(["income", "expense", "transfer"]),
      amount,
      description: z.string().trim().min(3).max(500),
    })
    .strict(),
  "settings.update": z
    .object({
      mode: z.enum(["fixed", "term", "individual"]),
      fixed_bps: z.number().int().min(0).max(100000),
      term_rates: z.record(
        z.string().regex(/^(?:[1-9]|[12]\d|3[0-6])$/),
        z.number().int().min(0).max(100000),
      ),
      prevent_negative_cash: z.boolean(),
    })
    .strict(),
};
export const commandEnvelope = z
  .object({
    action: z.enum(
      Object.keys(schemas) as [
        keyof typeof schemas,
        ...(keyof typeof schemas)[],
      ],
    ),
    payload: z.unknown(),
    key: id,
    tenant_id: id.optional(),
  })
  .strict();
