create or replace function public.overdue_registry_add(p_contract uuid,p_basis text,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' set timezone='Europe/Moscow' as $$
declare c public.contracts; u public.customers; b record; rid uuid;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.contracts where id=p_contract for update;
 if not found or not private.staff(c.tenant_id,array['owner']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_confirm is distinct from true or length(trim(coalesce(p_basis,''))) not between 5 and 200 then raise exception 'Укажите основание передачи данных и подтвердите сведения'; end if;
 select * into u from public.customers where tenant_id=c.tenant_id and id=c.customer_id;
 if private.registry_phone(u.phone) !~ '^7[0-9]{10}$' then raise exception 'Укажите корректный телефон клиента в карточке'; end if;
 select * into b from private.registry_balance(c.id,current_date-1);
 if b.amount<=0 then raise exception 'По договору нет подтверждённой просрочки'; end if;
 if exists(select 1 from public.payment_claims where contract_id=c.id and status='pending') then raise exception 'Сначала проверьте сообщения клиента об оплате'; end if;
 select id into rid from private.overdue_reports where contract_id=c.id and withdrawn_at is null;
 if found then return rid; end if;
 insert into private.overdue_reports(tenant_id,contract_id,customer_id,subject_user,phone,customer_name,cutoff,reported_amount,basis_reference,created_by)
 values(c.tenant_id,c.id,u.id,u.auth_user_id,private.registry_phone(u.phone),u.name,current_date-1,b.amount,trim(p_basis),auth.uid()) returning id into rid;
 insert into private.overdue_audit(actor,report_id,action) values(auth.uid(),rid,'add');
 perform private.notify_user(c.tenant_id,u.auth_user_id,'registry-add:'||rid,'Продавец добавил запись о просрочке в общий чёрный список HESAP. Откройте Профиль → Чёрный список: там можно проверить сведения и оспорить запись.');
 return rid;
end $$;

create or replace function public.overdue_registry_change(p_id uuid,p_action text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.overdue_reports;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from private.overdue_reports where id=p_id for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Укажите причину (5–500 символов)'; end if;
 if p_action='withdraw' then
  if not (private.platform_admin() or private.staff(r.tenant_id,array['owner'])) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if r.withdrawn_at is not null then return; end if;
  update private.overdue_reports set withdrawn_at=now(),withdrawal_reason=trim(p_reason) where id=p_id;
  perform private.notify_user(r.tenant_id,r.subject_user,'registry-withdraw:'||r.id,'Запись о просрочке отозвана продавцом или владельцем HESAP и исключена из общего поиска.');
 elsif p_action='dispute' then
  if r.subject_user is distinct from auth.uid() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if r.disputed_at is not null or r.withdrawn_at is not null then return; end if;
  update private.overdue_reports set disputed_at=now(),dispute_reason=trim(p_reason) where id=p_id;
  perform private.notify_owners(r.tenant_id,'registry-dispute:'||r.id,'Клиент оспорил запись в чёрном списке HESAP. Проверьте сведения в разделе «Чёрный список».');
  insert into private.telegram_deliveries(tenant_id,recipient,event_key,message)
  select null,id,'registry-dispute:'||r.id,'Клиент оспорил запись в чёрном списке. Проверьте её в панели HESAP.' from public.profiles where platform_admin
  on conflict do nothing;
 else raise exception 'Недопустимое действие'; end if;
 insert into private.overdue_audit(actor,report_id,action) values(auth.uid(),p_id,p_action);
end $$;
