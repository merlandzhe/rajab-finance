create or replace function public.approve_direct_installment_with_markup(
  p_id uuid, p_available boolean, p_markup_bps integer
)
returns jsonb
language plpgsql security definer
set search_path='' set "TimeZone"='Europe/Moscow'
as $$
declare
  t uuid:=private.current_tenant();
  u uuid:=auth.uid();
  r text:=private.current_role();
  a public.applications;
  v_profit bigint;
  v_total bigint;
  v_monthly bigint;
  v_first date;
  v_quote jsonb;
  v_contract uuid;
begin
  if u is null or t is null or r not in ('owner','manager') then
    raise exception 'Доступ запрещён' using errcode='42501';
  end if;
  if p_available is distinct from true then
    raise exception 'Подтвердите наличие товара';
  end if;
  if p_markup_bps is null or p_markup_bps < 0 or p_markup_bps > 10000 then
    raise exception 'Наценка должна быть от 0 до 100 процентов';
  end if;
  select * into a from public.applications
    where id=p_id and tenant_id=t for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if a.status='contracted' then
    select id into v_contract from public.contracts
      where tenant_id=t and application_id=a.id;
    if v_contract is not null then
      return jsonb_build_object('ok',true,'id',v_contract,'already_created',true);
    end if;
  end if;
  if a.status not in ('draft','review','clarification','approved',
    'awaiting_purchase','purchased','ready_to_sell') then
    raise exception 'Изменение условий доступно только до заключения договора';
  end if;
  if exists(select 1 from public.contracts where tenant_id=t and application_id=a.id) then
    raise exception 'Условия оформленного договора нельзя изменить';
  end if;
  v_profit:=round(a.estimated_cost::numeric*p_markup_bps/10000)::bigint;
  v_total:=a.estimated_cost+v_profit;
  if a.estimated_cost<=0 or a.months not between 1 and 36 or
     a.down_payment<0 or a.down_payment>=v_total then
    raise exception 'Стоимость, срок или первоначальный взнос некорректны';
  end if;
  v_monthly:=(v_total-a.down_payment)/a.months;
  if v_monthly<=0 then raise exception 'Слишком маленький ежемесячный платёж'; end if;
  v_first:=(current_date+interval '1 month')::date;
  v_quote:=coalesce(a.final_quote,'{}'::jsonb)||
    jsonb_build_object(
      'cost',a.estimated_cost::text,'profit',v_profit::text,
      'sale_price',v_total::text,'down_payment',a.down_payment::text,
      'months',a.months,'monthly_payment',v_monthly::text,
      'first_payment_on',v_first,'quoted_at',now(),
      'pricing_mode','individual','custom_markup_bps',p_markup_bps,
      'markup_percent',round(p_markup_bps::numeric/100,2),
      'seller_override',true
    );
  update public.applications set final_quote=v_quote
    where tenant_id=t and id=a.id;
  -- Same transaction and lock: this either creates the contract and schedule
  -- using the new fixed terms, or rolls the quote back on any error.
  return public.approve_direct_installment(p_id,true);
end $$;
revoke all on function public.approve_direct_installment_with_markup(uuid,boolean,integer) from public,anon;
grant execute on function public.approve_direct_installment_with_markup(uuid,boolean,integer) to authenticated;
comment on function public.approve_direct_installment_with_markup(uuid,boolean,integer)
  is 'Per-application markup override (basis points), atomic with draft contract creation. Caller must be owner or manager of the same company.';
