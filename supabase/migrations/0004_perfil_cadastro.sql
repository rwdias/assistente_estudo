-- Dados de cadastro no perfil: nome, objetivo de estudo e nascimento.
--
-- Segurança: o usuário pode ATUALIZAR apenas essas três colunas
-- (grant por coluna) — as colunas de quota de IA continuam sem grant
-- de update, então nem com a política de UPDATE dá para tocá-las.

alter table public.perfis
  add column nome varchar(120),
  add column objetivo varchar(60),
  add column nascimento date;

-- Trigger de signup passa a copiar os metadados enviados no cadastro;
-- para contas Google, o nome vem em full_name/name automaticamente.
create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfis (user_id, nome, objetivo, nascimento)
  values (
    new.id,
    left(coalesce(
      new.raw_user_meta_data->>'nome',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ), 120),
    left(new.raw_user_meta_data->>'objetivo', 60),
    case
      when new.raw_user_meta_data->>'nascimento' ~ '^\d{4}-\d{2}-\d{2}$'
        then (new.raw_user_meta_data->>'nascimento')::date
      else null
    end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Update restrito às colunas de perfil (a quota fica de fora do grant).
revoke update on public.perfis from authenticated;
grant update (nome, objetivo, nascimento) on public.perfis to authenticated;

create policy perfis_update on public.perfis
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
