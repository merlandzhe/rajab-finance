import type {Metadata} from "next";
import {Suspense} from "react";
import Script from "next/script";
import {TelegramBridge} from "@/components/telegram-bridge";
import {MerchantPaymentShortcut} from "@/components/merchant-payment-shortcut";
import {MerchantUnreadIndicator} from "@/components/merchant-unread-indicator";
import {UnifiedInbox} from "@/components/unified-inbox";
import {BuyerDirectTerms} from "@/components/buyer-direct-terms";
import {BuyerApplicationMonthly} from "@/components/buyer-application-monthly";
import {BuyerContractsNav} from "@/components/buyer-contracts-nav";
import {ContractNavigationBridge} from "@/components/contract-navigation-bridge";
import {CustomerTableContrastFix} from "@/components/customer-table-contrast-fix";
import {MerchantNotificationsSettingsEntry} from "@/components/merchant-notifications-settings-entry";
import {MerchantOverviewLegacyTelegramCleanup} from "@/components/merchant-overview-legacy-telegram-cleanup";
import {telegramMiniAppEnabled} from "@/lib/telegram-config";
import "./globals.css";
import "./hesap-design.css";
import "./buyer-ux-tune.css";
import "./merchant-premium.css";
import "./notifications-state.css";
import "./merchant-unread-indicator.css";
import "./unified-inbox.css";
import "./direct-installment.css";
import "./buyer-direct-terms.css";
import "./contract-markup.css";
import "./buyer-contracts.css";
import "./premium-form-fields.css";
import "./premium-ux-v2.css";
import "./customer-table-contrast.css";
import "./crm-calendar-shortcut.css";
import "./merchant-notifications-entry.css";
import "./merchant-settings-cleanup.css";
import "./hesap-signature.css";
import "./hesap-signature-v3.css";
export const metadata:Metadata={title:{default:"HESAP — учёт рассрочки",template:"%s · HESAP"},description:"Заявки, договоры и платежи. Личный кабинет покупателя и предпринимателя.",robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}){
 return <html lang="ru" suppressHydrationWarning><body className={telegramMiniAppEnabled()?"hesap mini-app-theme":"hesap"}>
 {telegramMiniAppEnabled()&&<><Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive"/><Suspense fallback={null}><TelegramBridge/></Suspense></>}
 <MerchantPaymentShortcut/><MerchantUnreadIndicator/><Suspense fallback={null}><UnifiedInbox/></Suspense>
 <BuyerDirectTerms/><BuyerApplicationMonthly/><BuyerContractsNav/><ContractNavigationBridge/>
 <CustomerTableContrastFix/><MerchantNotificationsSettingsEntry/><MerchantOverviewLegacyTelegramCleanup/>
 {children}</body></html>;
}
