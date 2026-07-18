-- Limite de IA por usuário.
--
-- Coluna de override (admin-only) em perfis: NULL = usa o limite padrão que a
-- Edge Function passa (IA_QUOTA_DIARIA); um inteiro define o teto diário
-- daquele usuário. O dono do projeto recebe um valor alto (ilimitado na
-- prática); os demais ficam no padrão.
--
-- O usuário NÃO altera o próprio limite: o grant de UPDATE em `perfis` é por
-- coluna (nome/objetivo/nascimento). Esta coluna nasce SEM grant de UPDATE
-- para `authenticated`, como as colunas de quota — só a service key/admin a
-- ajusta.

alter table public.perfis add column ia_limite_diario integer;

-- consumir_quota_ia passa a usar o override quando existir.
create or replace function public.consumir_quota_ia(p_limite integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_contagem integer;
  v_data date;
  v_limite integer;
begin
  if v_uid is null then
    return false;
  end if;

  insert into public.perfis (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  select ia_chamadas_contagem, ia_chamadas_data, coalesce(ia_limite_diario, p_limite)
  into v_contagem, v_data, v_limite
  from public.perfis
  where user_id = v_uid
  for update;

  if v_data is distinct from current_date then
    v_contagem := 0;
  end if;

  if v_contagem >= v_limite then
    update public.perfis
    set ia_chamadas_data = current_date, ia_chamadas_contagem = v_contagem
    where user_id = v_uid;
    return false;
  end if;

  update public.perfis
  set ia_chamadas_data = current_date, ia_chamadas_contagem = v_contagem + 1
  where user_id = v_uid;

  return true;
end;
$$;

-- Dono do projeto: ilimitado (valor alto). Idempotente.
update public.perfis
set ia_limite_diario = 1000000
where user_id = (select id from auth.users where email = 'rafaelmp.cwb@gmail.com');
