-- Intervalos contínuos de estudo. Pausas nunca são gravadas como estudo.
create table public.sessoes_estudo (
  id uuid primary key,
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  materia_id bigint not null references public.materias(id) on delete cascade,
  modo text not null check (modo in ('livre', 'pomodoro')),
  inicio timestamptz not null,
  fim timestamptz not null,
  check (fim >= inicio and fim <= inicio + interval '31 days')
);
create index sessoes_estudo_usuario_inicio on public.sessoes_estudo(usuario_id, inicio);
alter table public.sessoes_estudo enable row level security;
create policy sessoes_estudo_select on public.sessoes_estudo for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy sessoes_estudo_insert on public.sessoes_estudo for insert to authenticated
  with check (usuario_id = (select auth.uid()) and exists (
    select 1 from public.materias m where m.id = materia_id and m.usuario_id = (select auth.uid())
  ));
create policy sessoes_estudo_update on public.sessoes_estudo for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()) and exists (
    select 1 from public.materias m where m.id = materia_id and m.usuario_id = (select auth.uid())
  ));
revoke all on public.sessoes_estudo from anon, public, authenticated;
grant select, insert, update on public.sessoes_estudo to authenticated;

-- Idempotente: uma repetição/requisição atrasada não duplica nem reduz tempo.
create function public.salvar_tempo_estudo(p_id uuid, p_materia_id bigint, p_modo text,
  p_inicio timestamptz, p_fim timestamptz)
returns void language sql security invoker set search_path = '' as $$
  insert into public.sessoes_estudo as s (id, materia_id, modo, inicio, fim)
  values (p_id, p_materia_id, p_modo, p_inicio, p_fim)
  on conflict (id) do update set fim = greatest(s.fim, excluded.fim)
  where s.materia_id = excluded.materia_id and s.inicio = excluded.inicio and s.modo = excluded.modo;
$$;
revoke all on function public.salvar_tempo_estudo(uuid,bigint,text,timestamptz,timestamptz) from public, anon;
grant execute on function public.salvar_tempo_estudo(uuid,bigint,text,timestamptz,timestamptz) to authenticated;

-- Interseção de intervalos: uma sessão que cruza meia-noite é dividida nos
-- totais de cada período, respeitando o fuso enviado pelo navegador.
create function public.resumo_tempo_estudo(p_fuso text default 'America/Sao_Paulo')
returns table (materia_id bigint, total_segundos bigint, hoje_segundos bigint,
  semana_segundos bigint, mes_segundos bigint)
language sql stable security invoker set search_path = '' as $$
  with limites as (
    select date_trunc('day', now() at time zone p_fuso) at time zone p_fuso as hoje,
      date_trunc('week', now() at time zone p_fuso) at time zone p_fuso as semana,
      date_trunc('month', now() at time zone p_fuso) at time zone p_fuso as mes
  )
  select s.materia_id,
    floor(sum(extract(epoch from s.fim - s.inicio)))::bigint,
    floor(sum(greatest(0,extract(epoch from least(s.fim,now()) - greatest(s.inicio,l.hoje)))))::bigint,
    floor(sum(greatest(0,extract(epoch from least(s.fim,now()) - greatest(s.inicio,l.semana)))))::bigint,
    floor(sum(greatest(0,extract(epoch from least(s.fim,now()) - greatest(s.inicio,l.mes)))))::bigint
  from public.sessoes_estudo s cross join limites l
  group by s.materia_id;
$$;
revoke all on function public.resumo_tempo_estudo(text) from public, anon;
grant execute on function public.resumo_tempo_estudo(text) to authenticated;
