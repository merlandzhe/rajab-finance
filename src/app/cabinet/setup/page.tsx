import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { BuyerSetup } from "@/components/buyer-setup";
import { Brand } from "@/components/brand";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const mode = (await searchParams).mode;
  const s = await session();
  if (!s) redirect("/mini");
  if (s.role !== "client") redirect("/crm");
  return (
    <main className="container py onboarding-page">
      <Brand />
      <BuyerSetup
        mode={
          mode === "seller"
            ? "seller"
            : mode === "application"
              ? "application"
              : mode === "profile"
                ? "profile"
                : "phone"
        }
      />
    </main>
  );
}
