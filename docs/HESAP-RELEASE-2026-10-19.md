# HESAP release — 2026-10-19

Existing project: rajab-finance-mini. No new project. FootballRamenskoe unchanged.

- Midnight navy / warm gold theme across onboarding, buyer cabinet, merchant CRM and platform admin.
- HESAP book/check mark, metadata and document branding. Telegram header/background colors follow the product palette.
- Removed theme switch, debug organization IDs and obsolete production demo copy.
- Connected Telegram setup collapses to a status card.
- Documents state separate signing, and payment confirmations still require the merchant.
- Privacy information describes actual data handling; an approved operator policy with contacts remains outstanding.

Data cleanup: removed six named `Демо Клиент 01` through `06` and their seven applications in tenant 11111111-1111-4111-8111-111111111111. No contracts, purchases, documents or application messages existed for them. Kept the customer named Ислам and registered buyers. Removed demo qualifier from merchant display name using an exact-name condition.

Validation: TypeScript passed; 57 tests passed. Production deployment dpl_9xE7Zh43RHFmYYa3zjc2StwWa8mf.

Outstanding: Telegram's own bot/Mini App display name and avatar need updating separately; merchant onboarding and end-to-end notification delivery still require real-account verification. No bank acquiring or electronic signing added.
