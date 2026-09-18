-- Controle de Propostas Fast Track — schema inicial
create extension if not exists pgcrypto;

create table public.propostas (
  id                  uuid primary key default gen_random_uuid(),
  hubspot             bigint,
  data_prevista       date,
  prioridade          text,
  status              text,
  chamado             bigint,
  demanda             text,
  cliente             text,
  projeto             text,
  atividades          text,
  valor               numeric(14,2),
  arquiteto           text,
  comercial           text,
  dt_receb            date,
  dt_inicio           date,
  dt_prevista         date,
  dt_v1               date,
  dt_final            date,
  qtd_versao          integer,
  consultores         text,
  modulos             text,
  horas               numeric(10,2),
  data_ganho_perdido  date,
  status_bid          text,
  lost_review         text,
  obs                 text,
  -- controle
  excel_row           integer,
  origem              text not null default 'web',   -- web | chat | excel | import
  excluido            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          text
);
create index propostas_updated_at_idx on public.propostas (updated_at);
create index propostas_status_bid_idx on public.propostas (status_bid);

-- Quem pode acessar (lista de e-mails)
create table public.usuarios_permitidos (
  email      text primary key,
  nome       text,
  created_at timestamptz not null default now()
);

create or replace function public.usuario_permitido()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_permitidos u
    where lower(u.email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;
revoke execute on function public.usuario_permitido() from anon, public;
grant execute on function public.usuario_permitido() to authenticated;

-- Histórico de alterações
create table public.propostas_log (
  id          bigint generated always as identity primary key,
  proposta_id uuid not null,
  acao        text not null,           -- insert | update
  origem      text,
  usuario     text,
  alteracoes  jsonb,
  created_at  timestamptz not null default now()
);
create index propostas_log_proposta_idx on public.propostas_log (proposta_id);

create or replace function public.propostas_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.jwt()) ->> 'email', new.updated_by);
  return new;
end;
$$;

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
       and n.key not in ('updated_at','updated_by','origem');
    if diff is null then return new; end if;
  end if;
  insert into public.propostas_log (proposta_id, acao, origem, usuario, alteracoes)
  values (new.id, lower(tg_op), new.origem, new.updated_by, diff);
  return new;
end;
$$;
revoke execute on function public.propostas_after_write() from anon, authenticated, public;

create trigger trg_propostas_before before insert or update on public.propostas
  for each row execute function public.propostas_before_write();
create trigger trg_propostas_after after insert or update on public.propostas
  for each row execute function public.propostas_after_write();

-- RLS: só usuários da lista
alter table public.propostas enable row level security;
alter table public.propostas_log enable row level security;
alter table public.usuarios_permitidos enable row level security;

create policy "permitidos leem propostas" on public.propostas
  for select to authenticated using ((select public.usuario_permitido()));
create policy "permitidos inserem propostas" on public.propostas
  for insert to authenticated with check ((select public.usuario_permitido()));
create policy "permitidos alteram propostas" on public.propostas
  for update to authenticated using ((select public.usuario_permitido())) with check ((select public.usuario_permitido()));

create policy "permitidos leem log" on public.propostas_log
  for select to authenticated using ((select public.usuario_permitido()));

create policy "usuario ve o proprio cadastro" on public.usuarios_permitidos
  for select to authenticated using (lower(email) = lower((select auth.jwt()) ->> 'email'));

-- Tempo real
alter publication supabase_realtime add table public.propostas;

insert into public.usuarios_permitidos (email, nome) values ('aleffgh@gmail.com', 'Aleff');
