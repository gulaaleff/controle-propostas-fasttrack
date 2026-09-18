-- Lembrete por demanda
alter table public.propostas add column if not exists lembrete_em date;
alter table public.propostas add column if not exists lembrete_nota text;

-- Pedidos de sincronização feitos pelo site
create table public.sync_pedidos (
  id           uuid primary key default gen_random_uuid(),
  criado_em    timestamptz not null default now(),
  criado_por   text,
  status       text not null default 'pendente',   -- pendente | executando | concluido | erro
  mensagem     text,
  iniciado_em  timestamptz,
  concluido_em timestamptz
);
create index sync_pedidos_status_idx on public.sync_pedidos (status, criado_em desc);

-- Situação da sincronização (linha única)
create table public.sync_status (
  id            int primary key default 1 check (id = 1),
  ultima_sync   timestamptz,
  mensagem      text,
  resumo        jsonb,
  heartbeat     timestamptz,
  atualizado_em timestamptz not null default now()
);
insert into public.sync_status (id) values (1);

-- Configuração de alertas por usuário
create table public.alertas_config (
  email         text primary key,
  regras        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- Alertas adiados ou resolvidos
create table public.alertas_baixa (
  proposta_id   uuid not null,
  regra         text not null,
  usuario       text not null,
  adiado_ate    date,
  resolvido_em  timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (proposta_id, regra, usuario)
);

alter table public.sync_pedidos enable row level security;
alter table public.sync_status enable row level security;
alter table public.alertas_config enable row level security;
alter table public.alertas_baixa enable row level security;

create policy "permitidos leem pedidos" on public.sync_pedidos for select to authenticated using ((select private.usuario_permitido()));
create policy "permitidos criam pedidos" on public.sync_pedidos for insert to authenticated with check ((select private.usuario_permitido()));
create policy "permitidos atualizam pedidos" on public.sync_pedidos for update to authenticated using ((select private.usuario_permitido())) with check ((select private.usuario_permitido()));

create policy "permitidos leem status" on public.sync_status for select to authenticated using ((select private.usuario_permitido()));
create policy "permitidos atualizam status" on public.sync_status for update to authenticated using ((select private.usuario_permitido())) with check ((select private.usuario_permitido()));

create policy "config propria" on public.alertas_config for all to authenticated
  using (lower(email) = lower((select auth.jwt()) ->> 'email') and (select private.usuario_permitido()))
  with check (lower(email) = lower((select auth.jwt()) ->> 'email') and (select private.usuario_permitido()));

create policy "baixas proprias" on public.alertas_baixa for all to authenticated
  using (lower(usuario) = lower((select auth.jwt()) ->> 'email') and (select private.usuario_permitido()))
  with check (lower(usuario) = lower((select auth.jwt()) ->> 'email') and (select private.usuario_permitido()));

alter publication supabase_realtime add table public.sync_pedidos;
alter publication supabase_realtime add table public.sync_status;
