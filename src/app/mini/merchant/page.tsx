import { MerchantEntry } from "@/components/merchant-entry";
import { telegramBotUsername } from "@/lib/telegram-config";
import "./merchant-entry.css";
export const dynamic = "force-dynamic";
export default function Page() {
  return <MerchantEntry bot={telegramBotUsername()} />;
}
