import {redirect} from "next/navigation";
import {session} from "@/lib/auth";
import {getState} from "@/lib/repository";
import {CRM} from "@/components/crm";
import {BuyerSignatureHome} from "@/components/buyer-signature-home";
import {isDemo} from "@/lib/demo-db";
import {supabase} from "@/lib/supabase";
export const dynamic="force-dynamic";
export default async function Page(){
 const s=await session();
 if(!s)redirect("/mini");
 if(s.role!=="client")redirect("/crm");
 if(!isDemo()){
   const {data,error}=await (await supabase()).rpc("buyer_state");
   if(error)throw error;
   if(data?.profile&&!data.profile.phone_verified_at)redirect("/cabinet/setup");
 }
 const state=await getState(s);
 return <><BuyerSignatureHome data={state} session={s}/><CRM initial={state} session={s} path={["cabinet"]} demo={isDemo()}/></>;
}
