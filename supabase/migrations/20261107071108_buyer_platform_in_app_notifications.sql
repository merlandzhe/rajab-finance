CREATE TABLE public.in_app_notifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK(scope IN ('buyer','platform')),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX in_app_notifications_feed_idx ON public.in_app_notifications(recipient_user_id,scope,created_at DESC);
CREATE INDEX in_app_notifications_unread_idx ON public.in_app_notifications(recipient_user_id,scope,created_at DESC) WHERE read_at IS NULL;
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_select_own ON public.in_app_notifications FOR SELECT TO authenticated
USING(recipient_user_id = (select auth.uid()));
CREATE POLICY inbox_update_own ON public.in_app_notifications FOR UPDATE TO authenticated
USING(recipient_user_id = (select auth.uid()))
WITH CHECK(recipient_user_id = (select auth.uid()));
REVOKE ALL ON public.in_app_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.in_app_notifications TO authenticated;
GRANT UPDATE(read_at) ON public.in_app_notifications TO authenticated;

CREATE FUNCTION private.hesap_in_app_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE buyer_id uuid; admin_id uuid; item_name text;
BEGIN
  IF TG_TABLE_NAME='merchant_requests' THEN
    FOR admin_id IN SELECT id FROM public.profiles WHERE platform_admin IS TRUE LOOP
      INSERT INTO public.in_app_notifications(recipient_user_id,scope,kind,title,body,href)
      VALUES(admin_id,'platform','merchant_request','Новая заявка на подключение',
        'Магазин '||left(coalesce(NEW.shop_name,'без названия'),100)||' запрашивает доступ к HESAP.',
        '/crm/platform-requests');
    END LOOP;
  ELSIF TG_TABLE_NAME='applications' THEN
    IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
      SELECT auth_user_id INTO buyer_id FROM public.customers WHERE id=NEW.customer_id AND tenant_id=NEW.tenant_id;
      IF buyer_id IS NOT NULL THEN
        item_name:=left(coalesce(NEW.product_name,'Товар'),100);
        INSERT INTO public.in_app_notifications(recipient_user_id,scope,kind,title,body,href)
        VALUES(buyer_id,'buyer','application',
          CASE WHEN TG_OP='INSERT' THEN 'Заявка отправлена' ELSE 'Статус заявки обновлён' END,
          item_name||' · '|| CASE NEW.status WHEN 'review' THEN 'На рассмотрении' WHEN 'clarification' THEN 'Требуется уточнение'
            WHEN 'approved' THEN 'Одобрена' WHEN 'rejected' THEN 'Отклонена'
            WHEN 'contracted' THEN 'Договор оформлен' WHEN 'signed' THEN 'Договор оформлен'
            ELSE left(NEW.status,50) END,
          '/cabinet?view=applications');
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='application_messages' THEN
    SELECT c.auth_user_id INTO buyer_id
    FROM public.applications a JOIN public.customers c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
    WHERE a.id=NEW.application_id AND a.tenant_id=NEW.tenant_id;
    IF buyer_id IS NOT NULL AND buyer_id IS DISTINCT FROM NEW.author_id THEN
      INSERT INTO public.in_app_notifications(recipient_user_id,scope,kind,title,body,href)
      VALUES(buyer_id,'buyer','message','Новое сообщение по заявке',
        'Предприниматель ответил на вашу заявку.','/cabinet?view=applications');
    END IF;
  ELSIF TG_TABLE_NAME='contracts' THEN
    SELECT auth_user_id INTO buyer_id FROM public.customers WHERE id=NEW.customer_id AND tenant_id=NEW.tenant_id;
    IF buyer_id IS NOT NULL THEN
      INSERT INTO public.in_app_notifications(recipient_user_id,scope,kind,title,body,href)
      VALUES(buyer_id,'buyer','contract','Договор оформлен',
        'График платежей доступен в личном кабинете.','/cabinet?view=payments');
    END IF;
  ELSIF TG_TABLE_NAME='payment_claims' THEN
    IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
      SELECT c.auth_user_id INTO buyer_id FROM public.contracts ct
        JOIN public.customers c ON c.id=ct.customer_id AND c.tenant_id=ct.tenant_id
      WHERE ct.id=NEW.contract_id AND ct.tenant_id=NEW.tenant_id;
      IF buyer_id IS NOT NULL THEN
        INSERT INTO public.in_app_notifications(recipient_user_id,scope,kind,title,body,href)
        VALUES(buyer_id,'buyer','payment',
          CASE NEW.status WHEN 'confirmed' THEN 'Оплата подтверждена'
            WHEN 'rejected' THEN 'Оплата не подтверждена' ELSE 'Платёж ожидает проверки' END,
          CASE NEW.status WHEN 'confirmed' THEN 'Предприниматель подтвердил поступление средств.'
            WHEN 'rejected' THEN 'Свяжитесь с предпринимателем для уточнения платежа.'
            ELSE 'Сообщение об оплате отправлено предпринимателю.' END,
          '/cabinet?view=payments');
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='payments' THEN
    SELECT c.auth_user_id INTO buyer_id FROM public.contracts ct
      JOIN public.customers c ON c.id=ct.customer_id AND c.tenant_id=ct.tenant_id
    WHERE ct.id=NEW.contract_id AND ct.tenant_id=NEW.tenant_id;
    IF buyer_id IS NOT NULL THEN
      INSERT INTO public.in_app_notifications(recipient_user_id,scope,kind,title,body,href)
      VALUES(buyer_id,'buyer','payment',
        CASE WHEN NEW.reversal_of IS NOT NULL THEN 'Изменение по платежу' ELSE 'Оплата зарегистрирована' END,
        'Сведения о платеже обновлены в графике.','/cabinet?view=payments');
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'HESAP notification trigger error for %, SQLSTATE %',TG_TABLE_NAME,SQLSTATE;
  RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION private.hesap_in_app_events() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hes_inbox_request AFTER INSERT ON public.merchant_requests FOR EACH ROW EXECUTE FUNCTION private.hesap_in_app_events();
CREATE TRIGGER hes_inbox_application AFTER INSERT OR UPDATE OF status ON public.applications FOR EACH ROW EXECUTE FUNCTION private.hesap_in_app_events();
CREATE TRIGGER hes_inbox_app_message AFTER INSERT ON public.application_messages FOR EACH ROW EXECUTE FUNCTION private.hesap_in_app_events();
CREATE TRIGGER hes_inbox_contract AFTER INSERT ON public.contracts FOR EACH ROW EXECUTE FUNCTION private.hesap_in_app_events();
CREATE TRIGGER hes_inbox_claim AFTER INSERT OR UPDATE OF status ON public.payment_claims FOR EACH ROW EXECUTE FUNCTION private.hesap_in_app_events();
CREATE TRIGGER hes_inbox_payment AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION private.hesap_in_app_events();
