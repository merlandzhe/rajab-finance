create or replace function private.hesap_registered_buyer_guard()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status='awaiting_acceptance' and not exists(
    select 1 from public.customers c
    where c.tenant_id=new.tenant_id and c.id=new.customer_id
      and c.auth_user_id is not null
  ) then
    raise exception 'Покупатель должен зарегистрироваться в HESAP для подтверждения договора';
  end if;
  return new;
end $$;
revoke all on function private.hesap_registered_buyer_guard() from public,anon,authenticated;
create trigger direct_contract_buyer_must_register
before insert on public.contracts
for each row execute function private.hesap_registered_buyer_guard();
