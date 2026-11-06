import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { getState } from "@/lib/repository";
import { CRM } from "@/components/crm";
import { supabase } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function Page() {
  const s = await session();
  if (!s) redirect("/mini");
  if (s.role !== "client") redirect("/crm");
  {
    const { data, error } = await (await supabase()).rpc("buyer_state");
    if (error) throw error;
    if (
      data?.profile &&
      !data.profile.phone_verified_at
    )
      redirect("/cabinet/setup");
  }
  return (
    <CRM
      initial={await getState(s)}
      session={s}
      path={["cabinet"]}
    />
  );
}
