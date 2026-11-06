# HESAP release gate

## Current state (6 November 2026)

- Active production Vercel deployment: `dpl_8podhby5pkEJtcLNzyGLARZEKAfw` at `rajab-finance-mini.vercel.app`.
- Safe staging branch: `hesap/sync-miniapp-2026-11-06`. The old RAJAB landing and demo runtime have been removed there.
- Historical `main` still contains the October RAJAB MVP, not the current live Telegram Mini App.
- **Do not merge staging into main or promote a preview directly to production.**

The live production deployment was uploaded independently of GitHub. Reconciliation was verified using the SHA-1 of each Vercel source file (the Vercel file UID) and the SHA-1 of GitHub source text.

### Fully verified

- `src/components/buyer-cabinet.tsx`: **identical** to the active production version (SHA-1 `f2855396205d764d931506f04abf0894bc8b2e54`).
- `src/app/crm/[[...path]]/page.tsx`: the **pre-cleanup staging revision** matched production exactly (SHA-1 `7268f886229843af6389c5cedcb65c50be1e568f`). Changes since then are known: removing demo checks and redirecting legacy login links.

### Still requiring full source reconciliation

1. `src/components/crm.tsx`: production SHA-1 `71278c98f08d29b96f4adb2c3afe84bea912ce9d`.
2. `src/components/platform-access.tsx`: production SHA-1 `d955471c09cf75bdd6bb79f04b11e49b316dc072`.
3. `src/app/hesap-design.css`: production SHA-1 `ca7f721927af5334a79f15e429c2041df25473bf`.

All three differ from GitHub, partly because staging intentionally removed demos and fixed the false notification indicator. The Vercel connector only exposes the first portion of lengthy source files; matching prefixes cannot establish that the rest is identical. **Never overwrite the current production UI blindly.**

## Mandatory checks before production

1. Reconcile the three unresolved files against the full active production source. Review owner login, merchant access codes, switching merchants and existing permissions.
2. Run TypeScript, isolated PGlite tests, production-like build and browser tests.
3. Verify actual Telegram Mini App authorization from buyer, merchant and platform-owner accounts, without exposing bot or Supabase credentials in logs.
4. Verify tenant separation, existing contracts and payment displays read-only.
5. Stage a production-environment deployment without swapping aliases; inspect server logs and verify bot callbacks before promotion.
6. Keep the existing production deployment available for rollback and explicitly verify the final alias after promotion.

Do not delete the Vercel project or Supabase project: both are used by the current HESAP. Historical source and test fixtures are retained only for rollback and CI.
