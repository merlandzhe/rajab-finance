create or replace function private.hesap_direct_payment_guard()
returns trigger language plpgsql security definer set search_path=''
as $$
declare state text;
begin
 select status into state from public.contracts
 where tenant_id=new.tenant_id and id=new.contract_id;
 if state='awaiting_acceptance' then
   raise exception 'Покупатель ещё не подтвердил договор — платёж нельзя зарегистрировать';
 end if;
 return new;
end $$;
revoke all on function private.hesap_direct_payment_guard() from public,anon,authenticated;
create trigger direct_installment_payments_guard
before insert on public.payments for each row
execute function private.hesap_direct_payment_guard();
create trigger direct_installment_claims_guard
before insert on public.payment_claims for each row
execute function private.hesap_direct_payment_guard();
