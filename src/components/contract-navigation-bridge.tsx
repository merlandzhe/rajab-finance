"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function ContractNavigationBridge() {
  const router=useRouter();
  useEffect(()=>{
    function onClick(event:MouseEvent) {
      if(!(event.target instanceof Element))return;
      const anchor=event.target.closest<HTMLAnchorElement>("a[href]");
      if(!anchor || anchor.dataset.directPdf==="true")return;
      let url:URL;
      try{url=new URL(anchor.href,window.location.origin);}catch{return;}
      if(url.origin!==window.location.origin)return;
      const m=/^\/api\/contracts\/([0-9a-f-]{36})\/pdf\/?$/.exec(url.pathname);
      if(!m)return;
      event.preventDefault();
      event.stopPropagation();
      router.push("/contracts/"+m[1]+"/view");
    }
    document.addEventListener("click",onClick,true);
    return ()=>document.removeEventListener("click",onClick,true);
  },[router]);
  return null;
}
