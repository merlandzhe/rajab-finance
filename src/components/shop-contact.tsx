import { whatsappUrl } from "@/lib/merchant-input";
export type Shop = {
  tenant_id: string;
  display_name: string;
  whatsapp_phone?: string;
  logo_data?: string;
};
export function ShopContact({ shop }: { shop?: Shop }) {
  const href = whatsappUrl(shop?.whatsapp_phone);
  if (!shop) return null;
  return (
    <div className="shop-contact">
      <div className="row">
        {shop.logo_data && (
          <img
            className="shop-logo"
            src={shop.logo_data}
            width={36}
            height={36}
            alt=""
          />
        )}
        <span>{shop.display_name}</span>
      </div>
      {href && (
        <a
          className="btn btn-outline full mt"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          Написать продавцу в WhatsApp
        </a>
      )}
    </div>
  );
}
