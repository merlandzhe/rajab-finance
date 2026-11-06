import type { Pricing } from "./money";
export type Role = "owner" | "manager" | "cashier" | "client";
export type Session = {
  user_id: string;
  tenant_id: string | null;
  role: Role | null;
  name: string;
  platform_admin: boolean;
};
export type Base = { id: string; tenant_id: string; created_at: string };
export type Customer = Base & {
  name: string;
  city?: string;
  phone: string;
  email: string | null;
  notes: string;
  auth_user_id: string | null;
};
export type Application = Base & {
  customer_id: string;
  product_name: string;
  product_url: string | null;
  supplier: string;
  estimated_cost: string;
  down_payment: string;
  months: number;
  status: string;
  notes: string;
  created_by: string;
  final_quote: Record<string, string | number> | null;
};
export type Purchase = Base & {
  application_id: string;
  cost: string;
  purchased_on: string;
  document_id: string;
  supplier: string;
  ownership_confirmed: boolean;
};
export type DocumentRow = Base & {
  application_id: string;
  name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  kind: string;
};
export type Contract = Base & {
  customer_id: string;
  application_id: string;
  purchase_id: string;
  number: string;
  signed_on: string;
  cost: string;
  profit: string;
  sale_price: string;
  down_payment: string;
  months: number;
  first_payment_on: string;
  status: string;
  created_by: string;
  transferred_on: string | null;
  transfer_reference: string | null;
};
export type Schedule = Base & {
  contract_id: string;
  sequence: number;
  due_on: string;
  amount: string;
};
export type Payment = Base & {
  contract_id: string;
  cash_account_id: string;
  amount: string;
  reversal_of: string | null;
  reason: string;
  paid_on: string;
  created_by: string;
  operation_key: string;
};
export type CashTransaction = Base & {
  cash_account_id: string;
  payment_id: string | null;
  amount: string;
  kind: string;
  description: string;
  created_by: string;
};
export type State = {
  application_messages?: {
    id: string;
    tenant_id: string;
    application_id: string;
    author_role: string;
    message: string;
    created_at: string;
  }[];
  seller_directory?: {
    tenant_id: string;
    display_name: string;
    enabled: boolean;
    whatsapp_phone?: string;
    logo_data?: string;
  }[];
  payment_claims: (Base & {
    contract_id: string;
    amount: string;
    method: "sbp" | "cash";
    paid_on: string;
    status: "pending" | "confirmed" | "rejected";
    reason: string;
    payment_id: string | null;
  })[];
  organizations: { id: string; name: string; slug: string }[];
  customers: Customer[];
  applications: Application[];
  purchases: Purchase[];
  documents: DocumentRow[];
  contracts: Contract[];
  contract_items: (Base & {
    contract_id: string;
    product_name: string;
    product_url: string;
  })[];
  contract_versions: (Base & {
    contract_id: string;
    version: number;
    snapshot: Record<string, string | number>;
  })[];
  payment_schedules: Schedule[];
  payments: Payment[];
  payment_allocations: (Base & {
    payment_id: string;
    schedule_id: string;
    amount: string;
  })[];
  cash_accounts: (Base & { name: string })[];
  cash_transactions: CashTransaction[];
  settings: (Base & Pricing & { prevent_negative_cash: boolean })[];
  notifications: (Base & {
    kind: string;
    status: string;
    message: string;
    attempts: number;
  })[];
  audit_logs: (Base & {
    action: string;
    actor_id: string;
    entity_id: string;
    details: Record<string, string>;
  })[];
  members: (Base & { user_id: string; role: Role })[];
  subscriptions: (Base & { status: string })[];
};
