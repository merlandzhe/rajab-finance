# HESAP: payment details visibility

The buyer payment screen now shows payment instructions only for signed or transferred contracts with a matching payment schedule in the selected company. An application alone does not unlock payment instructions. The same condition is enforced in GET /api/payment-methods using server-authorized buyer state. Merchant editing is unchanged. Payment claim forms exclude contracts that do not meet this condition; historical claims remain visible.

Validation: TypeScript passed; regression test covers no contract, no schedule, wrong tenant, inactive statuses, signed and transferred contracts.

Deployment requested: dpl_BepsMM7oBkbRzGMSp4YZLbkxfnFM in existing rajab-finance-mini. Check Vercel READY status before treating it as published. No customer or financial data changed.

Prior release: merchant subscription migration applied on 2026-10-20, production dpl_433UnipuqbKTYAUB3zLpK32nWvw6 READY. Notification scheduler applied and enabled; authenticated dispatch returned HTTP 200 and cron executions succeeded. Full signed Telegram user flow still requires a user verification.
