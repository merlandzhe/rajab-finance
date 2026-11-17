import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBuyerRegistrationStep } from "../src/lib/buyer-registration";

test("Telegram provisional accounts must verify their number", () => {
  assert.equal(nextBuyerRegistrationStep({ name: "", city: "", phone: null, phone_verified_at: null, consent_at: null }), "phone");
  assert.equal(nextBuyerRegistrationStep({ name: "Buyer", city: "Moscow", phone: "+79990000000", phone_verified_at: null, consent_at: null }), "phone");
});
test("confirmed phone alone does not complete registration", () => {
  assert.equal(nextBuyerRegistrationStep({ name: "", city: "", phone: "+79990000000", phone_verified_at: "2026-11-17T12:00:00Z", consent_at: null }), "profile");
  assert.equal(nextBuyerRegistrationStep({ name: "Buyer", city: "Moscow", phone: "+79990000000", phone_verified_at: "2026-11-17T12:00:00Z", consent_at: null }), "profile");
});
test("full profile with consent completes registration", () => {
  assert.equal(nextBuyerRegistrationStep({ name: "Buyer", city: "Moscow", phone: "+79990000000", phone_verified_at: "2026-11-17T12:00:00Z", consent_at: "2026-11-17T12:02:00Z" }), null);
});
test("legacy invited customers without a buyer profile retain access", () => {
  assert.equal(nextBuyerRegistrationStep(null), null);
});
