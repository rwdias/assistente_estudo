-- "Saber mais": complementos gerados por IA sob demanda, guardados na própria
-- pergunta (cache) para não repetir chamadas ao LLM.
--
-- Regra: cada pedido acrescenta UM complemento novo, até no máximo 3. Se já
-- houver texto salvo, o front-end apenas exibe — só chama o LLM quando falta.
-- A escrita passa por função SECURITY INVOKER (RLS do dono aplica em select e
-- update) que impõe o teto de 3, evitando confiar no cliente para o limite.

alter table public.perguntas
  add column saber_mais jsonb not null default '[]'::jsonb
    constraint perguntas_saber_mais_check
      check (jsonb_typeof(saber_mais) = 'array' and jsonb_array_length(saber_mais) <= 3);

create function public.adicionar_saber_mais(p_pergunta_id bigint, p_texto text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_atual jsonb;
  v_novo jsonb;
begin
  if p_texto is null or btrim(p_texto) = '' then
    raise exception 'Texto vazio.';
  end if;

  -- RLS: se a pergunta não for do usuário, o select não devolve linha.
  select saber_mais into v_atual
  from public.perguntas
  where id = p_pergunta_id;

  if v_atual is null then
    raise exception 'Pergunta não encontrada.';
  end if;

  if jsonb_array_length(v_atual) >= 3 then
    raise exception 'Limite de complementos atingido.';
  end if;

  v_novo := v_atual || to_jsonb(p_texto);

  update public.perguntas
  set saber_mais = v_novo, updated_at = now()
  where id = p_pergunta_id;

  return v_novo;
end;
$$;

revoke execute on function public.adicionar_saber_mais(bigint, text) from public, anon;
grant execute on function public.adicionar_saber_mais(bigint, text) to authenticated;
