-- HESAP brand-only migration. Existing seller/merchant identity, signed deals,
-- identifiers, RLS policies, permissions and Telegram account linkage are unchanged.
-- Historic sent messages are preserved exactly as sent.
DO $hesap_brand$
DECLARE
  f record;
  definition text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind = 'f'
      AND ((n.nspname = 'private' AND p.proname IN ('application_notice', 'claim_notice', 'message_notice'))
        OR (n.nspname = 'public' AND p.proname IN ('queue_buyer_reminders', 'merchant_request_submit')))
  LOOP
    definition := pg_get_functiondef(f.oid);
    definition := replace(definition, 'RAJAB FINANCE', 'HESAP');
    IF f.proname = 'merchant_request_submit' THEN
      -- Avoid embedding a legacy hostname in a new owner notification.
      definition := replace(
        definition,
        'Откройте панель владельца: https://rajab-finance-mini.vercel.app/mini',
        'Откройте панель владельца HESAP.'
      );
    END IF;
    EXECUTE definition;
  END LOOP;

  -- Only unsent notifications are edited. Already delivered history is immutable.
  UPDATE private.telegram_deliveries
  SET message = replace(message, 'RAJAB FINANCE', 'HESAP')
  WHERE status IN ('pending', 'failed')
    AND position('RAJAB FINANCE' in message) > 0;
END
$hesap_brand$;
