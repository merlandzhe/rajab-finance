# HESAP: merchant access release

Prepared 2026-10-20. Existing project only; preserve customer and financial data.

## Implemented
- Buyer/merchant entry choices and verified Telegram merchant requests.
- Platform administrator request review, single-use applicant-bound activation codes, expiry, revocation, company blocking and subscription dates.
- Merchant shop name, optional image and company-specific WhatsApp contact.
- Durable Telegram delivery retries and authenticated dispatcher.
- Compact navy/gold interface with white cards.

Subscriptions are administered manually. No automated billing or real bank debit is implemented.

## Verification
64 automated tests passed, including tenant isolation, activation replay prevention and preservation of buyer profiles. TypeScript checking passed.

## Release status
NOT PUBLISHED. Production database migration was not applied: Supabase returned `Invalid or expired requestState` twice. A subsequent read confirmed `public.merchant_requests` is absent. Do not publish new application code before applying and verifying the migration.

1. Restore the existing Supabase connection for project `pqlhsxgtsubyereenysn`.
2. Apply `supabase/migrations/20261020064920_merchant_subscriptions.sql` and verify existing financial record counts are preserved.
3. Deploy to existing Vercel project `prj_olORcBZZlHV4qFlOhNOmLSAKvsMP`, team `team_hGoXCyt77hNQrEjWKncgxTie`. Use `deploy/vercel-mini.json` as the deployment's `vercel.json`, not the root demo configuration.
4. A production `NOTIFICATION_WORKER_SECRET` and a matching Vault secret named `hesap_notification_worker` were already configured. Do not expose or duplicate them.
5. Once the deployment is READY, apply `supabase/pending/notification_scheduler.sql` and verify scheduler and dispatcher responses.
6. Verify public mobile screens and actual authorized buyer/merchant/admin flows. Live end-to-end notification delivery has not yet been verified for this release.

Never change FootballRamenskoe resources. Existing application data must not be seeded, reset or removed.
