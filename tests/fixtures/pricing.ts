import type { Pricing } from "../../src/lib/money";
export const TEST_PRICING: Pricing = {
  mode: "term",
  fixed_bps: 1800,
  term_rates: { "3": 600, "6": 1200, "9": 1800, "12": 2400 },
  version: 1,
};
