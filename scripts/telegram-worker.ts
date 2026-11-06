// One-shot scheduler entrypoint. Run once per minute using your scheduler.
export {};
// Never prints authorization headers, token-bearing URLs or customer data.
const origin = process.env.APP_ORIGIN;
const secret = process.env.CRON_SECRET;
if (!origin || !secret)
  throw new Error("Set APP_ORIGIN and CRON_SECRET for the RAJAB deployment");
const parsed = new URL(origin);
if (
  parsed.protocol !== "https:" ||
  parsed.pathname !== "/" ||
  parsed.search ||
  parsed.hash
)
  throw new Error("APP_ORIGIN must be an HTTPS origin");
try {
  const response = await fetch(parsed.origin + "/api/telegram", {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(65000),
  });
  if (!response.ok) throw new Error(`Worker returned HTTP ${response.status}`);
  const result = await response.json();
  console.log(JSON.stringify({ sent: result.sent, failed: result.failed }));
} catch {
  console.error(
    "RAJAB notification worker failed; check deployment status and configuration",
  );
  process.exitCode = 1;
}
