-- O histórico ignora mudanças só de controle (linha da planilha, origem)
create or replace function public.propostas_after_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare diff jsonb;
begin
  if tg_op = 'INSERT' then
    diff := to_jsonb(new) - array['created_at','updated_at','updated_by'];
  else
    select jsonb_object_agg(n.key, jsonb_build_object('de', o.value, 'para', n.value))
      into diff
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and n.key not in ('updated_at','updated_by','origem','excel_row');
    if diff is null then return new; end if;
  end if;
  insert into public.propostas_log (proposta_id, acao, origem, usuario, alteracoes)
  values (new.id, lower(tg_op), new.origem, new.updated_by, diff);
  return new;
end;
$$;
revoke execute on function public.propostas_after_write() from anon, authenticated, public;
