/**
 * Retired overview-only Telegram setup panel.
 *
 * Telegram preferences are now managed at:
 *   /crm/notification-settings
 *
 * Keep this export temporarily for the existing MerchantOverview import,
 * without mounting the old duplicate setup controls or requesting extra
 * Telegram permissions on every visit to the business overview.
 */
export function MerchantTelegramSetup({ owner: _owner }: { owner: boolean }) {
  void _owner;
  return null;
}
