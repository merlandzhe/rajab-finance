"use client";
import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
type Scope = "buyer" | "platform";
type Item = {id:string;title:string;body:string;href:string;created_at:string;read_at:string|null};
type Feed = {items:Item[];unread:number;before:string|null};
export function UnifiedInbox(){
  const path=usePathname();
  const qs=useSearchParams();
  const [scope,setScope]=useState<Scope|null>(null);
  const [feed,setFeed]=useState<Feed|null>(null);
  const [slot,setSlot]=useState<HTMLElement|null>(null);
  const [failed,setFailed]=useState(false);
  const marked=useRef("");
  const pending=useRef(false);
  const showing=(scope==="buyer" && path==="/cabinet" && qs.get("view")==="notifications")||
    (scope==="platform" && path==="/crm/platform-notifications");
  const selector=(s:Scope)=>s==="buyer"
    ? '.buyer-app .pocket-header button[aria-label^="Уведомления"]'
    : 'a.notification-dot[href="/crm/platform-notifications"]';

  useEffect(()=>{
    if(path!=="/cabinet" && !path.startsWith("/crm")) {setScope(null);return;}
    const s:Scope=path==="/cabinet"?"buyer":"platform";
    const find=()=>{if(document.querySelector(selector(s)))setScope(c=>c===s?c:s);};
    find();
    const o=new MutationObserver(find);
    o.observe(document.body,{childList:true,subtree:true});
    return ()=>{o.disconnect();setScope(null);};
  },[path]);

  useEffect(()=>{
    if(!scope){setFeed(null);return;}
    let closed=false;
    const load=async()=>{
      if(document.visibilityState==="hidden")return;
      try{
        const r=await fetch("/api/inbox?scope="+scope,{cache:"no-store",credentials:"same-origin"});
        if(!r.ok)throw Error("inbox");
        const d:Feed=await r.json();
        if(!closed){setFeed(d);setFailed(false);}
      }catch{if(!closed)setFailed(true);}
    };
    void load();
    const timer=window.setInterval(()=>void load(),45000);
    const focus=()=>void load();
    window.addEventListener("focus",focus);
    document.addEventListener("visibilitychange",focus);
    return ()=>{closed=true;clearInterval(timer);window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",focus);};
  },[scope]);

  useEffect(()=>{
    if(!scope)return;
    const render=()=>{
      const bell=document.querySelector<HTMLElement>(selector(scope));
      if(!bell)return;
      const n=feed?.unread??0;
      let dot=bell.querySelector(".hesap-unread-badge");
      if(n>0&&!dot){
        dot=document.createElement("span");dot.className="hesap-unread-badge";
        dot.setAttribute("aria-hidden","true");bell.append(dot);
      }else if(!n&&dot)dot.remove();
      const label=n?"Уведомления: "+n+" непрочитанных":"Уведомления";
      if(bell.getAttribute("aria-label")!==label)bell.setAttribute("aria-label",label);
    };
    render();
    const observer=new MutationObserver(render);
    observer.observe(document.body,{childList:true,subtree:true});
    return ()=>observer.disconnect();
  },[scope,feed?.unread]);

  useEffect(()=>{
    setSlot(null);
    if(!showing)return;
    let node:HTMLElement|null=null;
    const mount=()=>{
      if(node?.isConnected)return;
      const anchor=scope==="buyer"
        ? document.querySelector(".buyer-app .pocket-content .purchase-card")
        : document.querySelector(".platform-access .screen-heading");
      if(!anchor)return;
      node=document.createElement("div");node.className="hesap-inbox-slot";
      scope==="buyer"?anchor.before(node):anchor.after(node);
      setSlot(node);
    };
    mount();
    const observer=new MutationObserver(mount);
    observer.observe(document.body,{childList:true,subtree:true});
    return ()=>{observer.disconnect();node?.remove();setSlot(null);};
  },[scope,showing]);

  useEffect(()=>{
    if(!showing||!slot||!scope||!feed?.unread||!feed.before)return;
    if(pending.current||marked.current===feed.before)return;
    pending.current=true;
    const before=feed.before;
    void (async()=>{
      try{
        const r=await fetch("/api/inbox",{method:"POST",cache:"no-store",
          credentials:"same-origin",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({scope,before})});
        if(!r.ok)return;
        const d:{unread:number}=await r.json();
        marked.current=before;
        setFeed(f=>f&&f.before===before
          ? {...f,unread:d.unread,items:f.items.map(x=>({...x,read_at:x.read_at??new Date().toISOString()}))}
          : f);
      }catch{/* Keep unread state on failure */}finally{pending.current=false;}
    })();
  },[scope,showing,slot,feed?.before,feed?.unread]);

  if(!showing||!slot)return null;
  return createPortal(
    <section className="hesap-inbox-panel" aria-label="События HESAP">
      <div className="hesap-inbox-title">
        <h2>{scope==="platform"?"Подключения и события":"Мои уведомления"}</h2>
        {!!feed?.unread&&<span className="hesap-inbox-counter">{feed.unread} новых</span>}
      </div>
      {failed&&!feed?<p className="hesap-inbox-empty">Не удалось загрузить. Обновите страницу.</p>
       :!feed?<p className="hesap-inbox-empty">Загружаем уведомления…</p>
       :feed.items.length===0?<p className="hesap-inbox-empty">Новых уведомлений нет. Здесь появятся важные события.</p>
       :<div className="hesap-inbox-list">{feed.items.map(x=>
          <a key={x.id} className={"hesap-inbox-item"+(x.read_at?"":" is-unread")}
             href={x.href.startsWith("/")&&!x.href.startsWith("//")?x.href:"#"}>
            <strong>{x.title}</strong><p>{x.body}</p>
            <small>{new Date(x.created_at).toLocaleString("ru-RU",
              {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</small>
          </a>
        )}</div>}
    </section>,slot);
}
