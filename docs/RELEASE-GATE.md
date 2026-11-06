# HESAP release gate

## Current state (6 November 2026)

- Active production Vercel deployment: `dpl_8podhby5pkEJtcLNzyGLARZEKAfw` at `rajab-finance-mini.vercel.app`.
- Safe staging branch: `hesap/sync-miniapp-2026-11-06`. The old RAJAB landing and demo runtime have been removed there.
- Historical `main` still contains the October RAJAB MVP, not the current live Telegram Mini App.
- **Do not merge staging into main or promote a preview directly to production.**

The live production deployment was uploaded independently from Git and contains newer interface changes. Before release, reconcile these five files from production into staging:

1. `src/components/crm.tsx`
2. `src/components/buyer-cabinet.tsx`
3. `src/components/platform-access.tsx`
4. `src/app/crm/[[...path]]/page.tsx`
5. `src/app/hesap-design.css`

These files affect buyer, merchant and owner screens. Passing synthetic tests does not prove that the production UI is preserved.

## Mandatory checks before production

1. Reconcile the five files against the most recent production source. Review owner login, merchant access codes, switching merchants and existing permissions.
2. Run TypeScript, isolated PGlite tests, production-like build and browser tests.
3. Verify actual Telegram Mini App authorization from buyer, merchant and platform-owner accounts, without exposing bot or Supabase credentials in logs.
4. Verify tenant separation, existing contracts and payment displays read-only.
5. Stage a production-environment deployment without swapping aliases; inspect server logs and verify bot callbacks before promotion.
6. Keep the existing production deployment available for rollback and explicitly verify the final alias after promotion.

Do not delete the Vercel project or Supabase project: both are used by the current HESAP. Historical source and test fixtures are retained only for rollback and CI.
