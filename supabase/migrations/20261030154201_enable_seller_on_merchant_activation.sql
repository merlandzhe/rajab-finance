do $migration$
declare definition text; needle text := ' update private.merchant_codes set used_at=now() where id=c.id;';
begin
 select pg_get_functiondef('public.merchant_activate(text)'::regprocedure) into definition;
 if strpos(definition,needle)=0 then raise exception 'Unexpected merchant_activate definition'; end if;
 definition:=replace(definition,needle,E' update public.seller_directory set enabled=true where tenant_id=c.tenant_id;\n'||needle);
 execute definition;
end $migration$;
