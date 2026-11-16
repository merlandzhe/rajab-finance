import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { State, Contract } from "./types";
import { money } from "./money";

const navy=rgb(0.07,0.17,0.24),gold=rgb(0.76,0.58,0.32),grey=rgb(0.38,0.45,0.5);
function percent(cost:string,profit:string) {
  const base=Number(cost);
  if (!Number.isFinite(base)||base<=0) return "0";
  const result=100*Number(profit)/base;
  return new Intl.NumberFormat("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2}).format(result);
}
export async function directInstallmentPdf(data: State, c: Contract) {
  const snapshot=data.contract_versions.find(v=>v.contract_id===c.id)?.snapshot;
  if (!snapshot) throw Error("Условия договора не найдены");
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const base=path.join(process.cwd(),"public","fonts");
  const font=await pdf.embedFont(await readFile(path.join(base,"DejaVuSans.ttf")),{subset:true});
  const bold=await pdf.embedFont(await readFile(path.join(base,"DejaVuSans-Bold.ttf")),{subset:true});
  let page!:PDFPage;
  let y=0;
  function begin(){
    page=pdf.addPage([595,842]);y=790;
    page.drawText("HESAP",{x:42,y,size:17,font:bold,color:gold});
    y=748;
  }
  function line(value:string,size=11,f:PDFFont=font,color=navy) {
    const words=String(value).replace(/[\n\r\t]/g," ").split(/\s+/);
    let buffer="";
    function write(text:string){
      if(y<70)begin();
      page.drawText(text,{x:42,y,font:f,size,color});y-=size*1.65;
    }
    for(const word of words){
      const next=buffer?buffer+" "+word:word;
      if(buffer&&f.widthOfTextAtSize(next,size)>500){write(buffer);buffer=word;}
      else buffer=next;
    }
    if(buffer)write(buffer);
  }
  begin();
  line("Договор продажи товара в рассрочку",19,bold);
  line("Номер "+c.number+" · Дата подготовки "+c.signed_on,10,font,grey);
  y-=8;
  line(c.status==="awaiting_acceptance"
    ?"ПРОЕКТ: ожидает подтверждения покупателя"
    :"Условия подтверждены покупателем",11,bold,gold);
  line("Это учётный документ HESAP. Юридическая сила электронного подписания определяется соглашением сторон и законодательством.",9,font,grey);
  y-=15;
  line("Стороны и товар",13,bold);
  line("Продавец: "+String(snapshot.seller_name??"Организация"),10);
  line("Покупатель: "+String(snapshot.customer_name??"Покупатель"),10);
  line("Товар: "+String(snapshot.product_name??"Товар"),10);
  y-=16;
  line("Условия рассрочки",13,bold);
  line("Стоимость товара: "+money(c.cost));
  line("Наценка продавца: "+percent(c.cost,c.profit)+" % ("+money(c.profit)+")");
  line("Итоговая цена продажи: "+money(c.sale_price),11,bold);
  line("Первоначальный взнос: "+money(c.down_payment));
  line("Срок: "+c.months+" месяцев");
  line("Первый платёж: "+c.first_payment_on);
  y-=16;
  line("График платежей",13,bold);
  const rows=data.payment_schedules.filter(row=>row.contract_id===c.id)
    .sort((x,z)=>x.sequence-z.sequence);
  for(const item of rows){
    line((item.sequence===0?"Первоначальный взнос":"Платёж №"+item.sequence)
      +" · "+item.due_on+" · "+money(item.amount),10);
  }
  y-=16;
  line("Согласованные условия фиксируются при подтверждении покупателем.",10,font,grey);
  line("Претензии, обмен и возвраты определяются договором и законом.",10,font,grey);
  return pdf.save();
}
