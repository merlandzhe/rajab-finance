import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { BuyerContractsPage } from "@/components/buyer-contracts-page";
export const dynamic = "force-dynamic";

export default async function Page() {
  const current = await session();
  if (!current) redirect("/mini");
  if (current.role !== "client") redirect("/crm");
  const data = await getState(current);
  return <BuyerContractsPage data={data} />;
}
