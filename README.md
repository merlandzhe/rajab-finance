# HESAP — Telegram Mini App

Production project: `rajab-finance-mini` on Vercel. Source-control repository: `merlandzhe/rajab-finance`.

This snapshot comes from the user-provided `Hes .zip` (approximately 30 October 2026). Most files have matching SHA-1 digests with the currently deployed version, but the following files need a merge from the newer production deployment before promoting to `main`:

- `src/components/crm.tsx`
- `src/components/buyer-cabinet.tsx`
- `src/components/platform-access.tsx`
- `src/app/crm/[[...path]]/page.tsx`
- `src/app/hesap-design.css`

The production `vercel.json` configuration has already been updated in this staging snapshot; do not reintroduce `DEMO_DEPLOYMENT=true`.

## Deploy procedure

1. Work in the `hesap/sync-miniapp-2026-11-06` branch only. The original October 14 repository snapshot is preserved under `archive/rajab-finance-2026-10-14`.
2. Review and merge the five production UI files into this branch.
3. Set Vercel environment variables in Vercel project settings only. **Never** commit secrets or actual customer data.
4. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build` in a trusted environment with Node.js 24. Do not make preview work by enabling demo mode or bypassing authentication.
5. Smoke-test the buyer, seller, and owner Telegram flows and ensure the storage/security model matches the current Supabase project before promoting a tested build.

The old local PGlite demo test infrastructure is dormant in production (`DEMO_MODE=false`) and is not a second deployed website. Demo fixtures are kept only where needed for tests or compatibility; they can be removed after a complete safe refactor.

This public repository is **not** a place for passports, receipts, customer data, database dumps, `.env.local`, service keys, Telegram tokens, or private contracts.
