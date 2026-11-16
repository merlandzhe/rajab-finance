create or replace function public.overdue_registry_state(p_phone text default null) returns jsonb
language plpgsql security definer set search_path='' set timezone='Europe/Moscow' as $$
declare v_phone text; owner_access boolean; result jsonb;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 owner_access:=private.staff(private.current_tenant(),array['owner']);
 if not (coalesce(owner_access,false) or coalesce(private.platform_admin(),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_phone is not null then
  if not owner_access then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  v_phone:=private.registry_phone(p_phone);
  if v_phone !~ '^7[0-9]{10}$' then raise exception 'Введите полный номер телефона'; end if;
  if not public.consume_rate_limit('registry-search:'||auth.uid(),30,86400) then raise exception 'RATE_LIMIT'; end if;
  insert into private.overdue_audit(actor,action) values(auth.uid(),'search');
 end if;
 select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]') into result from (
 select r.created_at,jsonb_build_object('id',r.id,'company',o.name,
 'name',case when p_phone is null then r.customer_name else left(r.customer_name,1)||'…' end,
 'phone',case when p_phone is null then '+'||r.phone else null end,
 'amount',b.amount::text,'reported_amount',r.reported_amount::text,
 'days',case when b.oldest is null then 0 else current_date-b.oldest end,
 'status',case when r.withdrawn_at is not null then 'withdrawn' when b.amount=0 then 'resolved' when r.disputed_at is not null then 'disputed' else 'overdue' end,
 'disputed',r.disputed_at is not null,'created_at',r.created_at,
 'own',owner_access and r.tenant_id=private.current_tenant(),
 'can_withdraw',p_phone is null and (private.platform_admin() or (owner_access and r.tenant_id=private.current_tenant())) and r.withdrawn_at is null,
 'can_dispute',r.subject_user=auth.uid() and r.disputed_at is null and r.withdrawn_at is null,
 'dispute_reason',case when p_phone is null then r.dispute_reason else null end,
 'basis_reference',case when p_phone is null and (private.platform_admin() or (owner_access and r.tenant_id=private.current_tenant())) then r.basis_reference else null end,
 'withdrawal_reason',case when p_phone is null then r.withdrawal_reason else null end) item
 from private.overdue_reports r join public.organizations o on o.id=r.tenant_id
 cross join lateral private.registry_balance(r.contract_id,r.cutoff) b
 where (p_phone is not null and r.phone=v_phone and r.withdrawn_at is null)
 or (p_phone is null and (private.platform_admin() or (owner_access and r.tenant_id=private.current_tenant())))
 order by r.created_at desc limit 100
 ) x;
 return result;
end $$;
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
 perform private.notify_user(c.tenant_id,u.auth_user_id,'registry-add:'||rid,'Продавец добавил запись о просрочке в общий чёрный список HESAP. Для проверки сведений или оспаривания записи напишите владельцу HESAP: https://t.me/merlandzhe.');
 return rid;
end $$;
