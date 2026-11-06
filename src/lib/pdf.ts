import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { State, Contract } from "./types";
import { money } from "./money";
const emerald = rgb(0.051, 0.137, 0.196),
  muted = rgb(0.43, 0.49, 0.46),
  gold = rgb(0.788, 0.643, 0.36),
  line = rgb(0.89, 0.92, 0.9);
export async function contractPdf(data: State, c: Contract) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(path.join(process.cwd(), "public/fonts/DejaVuSans.ttf")),
    { subset: true },
  );
  const bold = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "public/fonts/DejaVuSans-Bold.ttf"),
    ),
    { subset: true },
  );
  const version = data.contract_versions.find(
    (v) => v.contract_id === c.id,
  )?.snapshot;
  if (!version) throw new Error("Снимок договора отсутствует");
  let page!: PDFPage;
  let y = 0;
  function newPage() {
    page = pdf.addPage([595.28, 841.89]);
    y = 790;
    page.drawText("HESAP", {
      x: 45,
      y,
      size: 15,
      font: bold,
      color: emerald,
    });
    page.drawText("ДОКУМЕНТ ДЛЯ ПОДПИСАНИЯ", {
      x: 335,
      y: 793,
      size: 8,
      font: bold,
      color: gold,
    });
    y = 754;
  }
  function text(value: string, size = 10, f: PDFFont = font, color = emerald) {
    const words = value.replace(/[\r\n]+/g, " ").split(" ");
    let row = "";
    const put = (s: string) => {
      if (y < 80) newPage();
      page.drawText(s, { x: 45, y, size, font: f, color });
      y -= size * 1.6;
    };
    for (const word of words) {
      const candidate = row ? row + " " + word : word;
      if (f.widthOfTextAtSize(candidate, size) > 500 && row) {
        put(row);
        row = word;
      } else row = candidate;
    }
    if (row) put(row);
  }
  function rule() {
    page.drawLine({
      start: { x: 45, y: y + 1 },
      end: { x: 550, y: y + 1 },
      color: line,
      thickness: 1,
    });
    y -= 14;
  }
  newPage();
  text("Договор товарной мурабахи", 21, bold);
  y -= 7;
  text(
    c.number +
      "  /  " +
      new Date(c.signed_on + "T00:00:00").toLocaleDateString("ru-RU"),
    10,
    font,
    muted,
  );
  y -= 13;
  text("Не является юридически утверждённым договором", 11, bold, gold);
  y -= 14;
  text("Стороны и предмет сделки", 12, bold);
  y -= 4;
  text("Продавец: " + String(version.seller_name));
  text("Покупатель: " + String(version.customer_name));
  text("Товар: " + String(version.product_name));
  text(
    "Приобретение продавцом: подтверждено в CRM. ID закупки: " + c.purchase_id,
    8,
    font,
    muted,
  );
  y -= 12;
  rule();
  const fields = [
    ["Себестоимость товара", money(c.cost)],
    ["Согласованная прибыль продавца", money(c.profit)],
    ["Фиксированная цена продажи", money(c.sale_price)],
    ["Первоначальный взнос по условиям", money(c.down_payment)],
    ["Срок рассрочки", c.months + " мес."],
    [
      "Версия тарифа / шаблона",
      String(version.settings_version) +
        " / " +
        String(version.template_version ?? 1),
    ],
  ];
  for (const [label, value] of fields) {
    page.drawText(label, { x: 45, y, size: 10, font, color: muted });
    page.drawText(value, {
      x: 550 - bold.widthOfTextAtSize(value, 10),
      y,
      size: 10,
      font: bold,
      color: emerald,
    });
    y -= 22;
  }
  y -= 6;
  rule();
  text("График платежей", 13, bold);
  y -= 8;
  function tableHeader() {
    page.drawRectangle({
      x: 45,
      y: y - 8,
      width: 505,
      height: 25,
      color: rgb(0.94, 0.96, 0.94),
    });
    for (const [v, x] of [
      ["Платёж", 55],
      ["Дата", 230],
      ["Сумма, ₽", 430],
    ] as const)
      page.drawText(v, { x, y, size: 9, font: bold, color: emerald });
    y -= 30;
  }
  tableHeader();
  for (const row of data.payment_schedules
    .filter((s) => s.contract_id === c.id)
    .sort((a, b) => a.sequence - b.sequence)) {
    if (y < 120) {
      newPage();
      text(c.number + " / продолжение графика", 13, bold);
      y -= 18;
      tableHeader();
    }
    const date = new Date(row.due_on + "T00:00:00").toLocaleDateString("ru-RU");
    page.drawText(
      row.sequence === 0 ? "Первоначальный взнос" : "Платёж " + row.sequence,
      { x: 55, y, size: 9, font, color: emerald },
    );
    page.drawText(date, { x: 230, y, size: 9, font, color: emerald });
    const value = money(row.amount);
    page.drawText(value, {
      x: 540 - font.widthOfTextAtSize(value, 9),
      y,
      size: 9,
      font,
      color: emerald,
    });
    y -= 10;
    page.drawLine({
      start: { x: 45, y },
      end: { x: 550, y },
      color: line,
      thickness: 0.5,
    });
    y -= 12;
  }
  y -= 12;
  text("Итого по графику: " + money(c.sale_price), 11, bold);
  y -= 12;
  text(
    "Суммы взяты из неизменяемого снимка заключённой сделки. Создание договора не подтверждает фактическое получение взноса или остальных платежей.",
    8,
    font,
    muted,
  );
  text(
    "Юридические положения, правила возвратов, изменения условий, перехода рисков и досрочного погашения должны быть согласованы специалистами. Электронная подпись и банковское списание в HESAP не выполняются.",
    8,
    font,
    muted,
  );
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: 45, y: 48 },
      end: { x: 550, y: 48 },
      color: line,
      thickness: 1,
    });
    p.drawText("HESAP · Подписание сторонами выполняется отдельно", {
      x: 45,
      y: 32,
      size: 7,
      font,
      color: muted,
    });
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: 520,
      y: 32,
      size: 8,
      font,
      color: muted,
    });
  });
  pdf.setTitle(c.number + " - договор и график платежей");
  pdf.setAuthor("HESAP");
  return pdf.save();
}
export async function testReceipt(product: string, cost: string) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const f = await pdf.embedFont(await readFile("public/fonts/DejaVuSans.ttf"), {
    subset: true,
  });
  const p = pdf.addPage([595, 420]);
  for (const [i, t] of [
    "ДЕМОНСТРАЦИОННЫЙ ДОКУМЕНТ ЗАКУПКИ",
    product,
    "Стоимость: " + money(cost),
    "Вымышленный поставщик. Только для тестирования.",
    "Не является кассовым чеком или подтверждением реальной покупки.",
  ].entries())
    p.drawText(t, {
      x: 35,
      y: 365 - i * 45,
      size: i === 0 ? 13 : 10,
      font: f,
      color: emerald,
    });
  return pdf.save();
}
