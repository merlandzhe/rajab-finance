import type { State } from "./types";

// The caller supplies only the buyer's server-authorized state.
export function payableContracts(
  data: Pick<State, "contracts" | "payment_schedules">,
  tenantId?: string,
) {
  return data.contracts.filter(
    (c) =>
      (!tenantId || c.tenant_id === tenantId) &&
      ["signed", "transferred"].includes(c.status) &&
      data.payment_schedules.some(
        (p) => p.contract_id === c.id && p.tenant_id === c.tenant_id,
      ),
  );
}
