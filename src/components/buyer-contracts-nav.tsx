"use client";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FileText } from "lucide-react";

export function BuyerContractsNav() {
  const pathname=usePathname();
  const [mount,setMount]=useState<HTMLElement|null>(null);
  useEffect(()=>{
    if(pathname!=="/cabinet") {setMount(null);return;}
    let target:HTMLElement|null=null;
    const find=()=>{
      if(target?.isConnected)return;
      const bar=document.querySelector<HTMLElement>(".buyer-app nav.pocket-nav");
      if(!bar)return;
      target=document.createElement("span");
      target.className="hesap-contracts-nav-slot";
      bar.insertBefore(target,bar.children[2]??null);
      setMount(target);
    };
    find();
    const observer=new MutationObserver(find);
    observer.observe(document.body,{subtree:true,childList:true});
    return ()=>{observer.disconnect();target?.remove();setMount(null);};
  },[pathname]);
  if(!mount||pathname!=="/cabinet")return null;
  return createPortal(
    <Link href="/cabinet/contracts" className="hesap-contracts-nav-link"><FileText size={21}/><span>Договоры</span></Link>,
    mount,
  );
}
