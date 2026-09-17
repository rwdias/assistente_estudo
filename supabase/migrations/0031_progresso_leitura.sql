-- A posição pertence à conta e ao caminho, mesmo sem metadados do material.
create table public.progresso_leitura (
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  caminho text not null,
  pagina integer not null check (pagina > 0),
  atualizado_em timestamptz not null,
  primary key (usuario_id, caminho),
  check (split_part(caminho, '/', 1) = usuario_id::text)
);
alter table public.progresso_leitura enable row level security;
create policy progresso_leitura_conta on public.progresso_leitura
  for all to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));
revoke all on public.progresso_leitura from public, anon, authenticated;
grant select, insert, update on public.progresso_leitura to authenticated;

-- Permite voltar páginas e ignora requisições antigas que chegam atrasadas.
create function public.salvar_progresso_leitura(p_caminho text, p_pagina integer, p_atualizado_em timestamptz)
returns void language sql security invoker set search_path = '' as $$
  insert into public.progresso_leitura as p (caminho, pagina, atualizado_em)
  values (p_caminho, p_pagina, p_atualizado_em)
  on conflict (usuario_id, caminho) do update
    set pagina = excluded.pagina, atualizado_em = excluded.atualizado_em
    where excluded.atualizado_em > p.atualizado_em;
$$;
revoke all on function public.salvar_progresso_leitura(text,integer,timestamptz) from public, anon;
grant execute on function public.salvar_progresso_leitura(text,integer,timestamptz) to authenticated;
