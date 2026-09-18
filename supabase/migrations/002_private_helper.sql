-- Move a função de permissão para um schema não exposto pela API
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.usuario_permitido()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_permitidos u
    where lower(u.email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;
revoke execute on function private.usuario_permitido() from anon, public;
grant execute on function private.usuario_permitido() to authenticated;

alter policy "permitidos leem propostas" on public.propostas using ((select private.usuario_permitido()));
alter policy "permitidos inserem propostas" on public.propostas with check ((select private.usuario_permitido()));
alter policy "permitidos alteram propostas" on public.propostas using ((select private.usuario_permitido())) with check ((select private.usuario_permitido()));
alter policy "permitidos leem log" on public.propostas_log using ((select private.usuario_permitido()));

drop function public.usuario_permitido();
