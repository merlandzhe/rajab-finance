import { MerchantEntry } from "@/components/merchant-entry";
import { telegramBotUsername } from "@/lib/telegram-config";
export const dynamic = "force-dynamic";
export default function Page() {
  return <MerchantEntry bot={telegramBotUsername()} />;
}
