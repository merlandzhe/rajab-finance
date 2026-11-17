export type BuyerRegistrationProfile = {
  phone?: string | null;
  phone_verified_at?: string | null;
  consent_at?: string | null;
  name?: string | null;
  city?: string | null;
};

/**
 * The Telegram user is provisionally authenticated before sharing a contact.
 * Registration is complete only after Telegram verifies the phone and the
 * buyer saves the profile + personal-data consent. Invited legacy clients
 * without a buyer_profiles row retain their existing contract access.
 */
export function nextBuyerRegistrationStep(
  profile: BuyerRegistrationProfile | null | undefined,
): "phone" | "profile" | null {
  if (!profile) return null;
  if (!profile.phone?.trim() || !profile.phone_verified_at) return "phone";
  if (!profile.name?.trim() || !profile.city?.trim() || !profile.consent_at)
    return "profile";
  return null;
}
