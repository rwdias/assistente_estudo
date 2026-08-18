-- Edição de pergunta/flashcard pelo dono.
--
-- Por que RPC e não UPDATE direto do PostgREST: trocar as alternativas exige
-- apagar as antigas e inserir as novas. Em duas chamadas separadas, uma falha
-- no meio deixaria a pergunta SEM alternativas. Aqui as duas operações estão
-- na mesma transação (tudo ou nada).
--
-- SECURITY INVOKER: o RLS do dono continua valendo em cada comando — o select
-- inicial não devolve linha para pergunta de outro usuário, e o update de
-- subdivisao_id passa pelo WITH CHECK da policy perguntas_update (não dá para
-- mover a pergunta para a matéria de outra pessoa).
--
-- Variantes: se o conteúdo mudou (enunciado ou alternativas), as variantes
-- existentes foram geradas a partir do texto ANTIGO e podem ter virado
-- mentira. São descartadas automaticamente; mudar só o tópico não descarta.

create function public.atualizar_pergunta(
  p_pergunta_id bigint,
  p_enunciado text,
  p_verso text,
  p_subdivisao_id bigint,
  p_opcoes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tipo varchar(20);
  v_enunciado_antigo text;
  v_n_opcoes integer;
  v_n_corretas integer;
  v_mudou boolean;
  v_descartadas integer := 0;
begin
  if p_enunciado is null or btrim(p_enunciado) = '' then
    raise exception 'O enunciado não pode ficar vazio.';
  end if;

  -- RLS: pergunta de outro usuário simplesmente não aparece aqui.
  select tipo, enunciado into v_tipo, v_enunciado_antigo
  from public.perguntas
  where id = p_pergunta_id;

  if v_tipo is null then
    raise exception 'Pergunta não encontrada.';
  end if;

  if v_tipo = 'flashcard' then
    if p_verso is null or btrim(p_verso) = '' then
      raise exception 'O verso não pode ficar vazio.';
    end if;
  else
    select count(*), count(*) filter (where (e->>'correta')::boolean)
      into v_n_opcoes, v_n_corretas
    from jsonb_array_elements(coalesce(p_opcoes, '[]'::jsonb)) e;

    if v_n_opcoes < 2 then
      raise exception 'A pergunta precisa de pelo menos duas alternativas.';
    end if;
    if v_n_corretas < 1 then
      raise exception 'Marque pelo menos uma alternativa como correta.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_opcoes) e
      where btrim(coalesce(e->>'texto', '')) = ''
    ) then
      raise exception 'Nenhuma alternativa pode ficar sem texto.';
    end if;
  end if;

  -- O conteúdo mudou? (para decidir sobre as variantes)
  v_mudou := v_enunciado_antigo is distinct from p_enunciado;

  if not v_mudou and v_tipo <> 'flashcard' then
    select
      exists (
        select o.texto, o.correta from public.opcoes o where o.pergunta_id = p_pergunta_id
        except
        select e->>'texto', (e->>'correta')::boolean from jsonb_array_elements(p_opcoes) e
      )
      or exists (
        select e->>'texto', (e->>'correta')::boolean from jsonb_array_elements(p_opcoes) e
        except
        select o.texto, o.correta from public.opcoes o where o.pergunta_id = p_pergunta_id
      )
    into v_mudou;
  end if;

  update public.perguntas set
    enunciado = p_enunciado,
    verso = case when v_tipo = 'flashcard' then p_verso else verso end,
    subdivisao_id = coalesce(p_subdivisao_id, subdivisao_id),
    updated_at = now()
  where id = p_pergunta_id;

  if v_tipo <> 'flashcard' then
    delete from public.opcoes where pergunta_id = p_pergunta_id;

    insert into public.opcoes (pergunta_id, texto, correta, ordem)
    select p_pergunta_id, e.valor->>'texto', (e.valor->>'correta')::boolean, e.ord::integer
    from jsonb_array_elements(p_opcoes) with ordinality as e(valor, ord);
  end if;

  if v_mudou then
    update public.pergunta_variantes
    set descartada = true
    where pergunta_id = p_pergunta_id and not descartada;
    get diagnostics v_descartadas = row_count;
  end if;

  return jsonb_build_object(
    'tipo', v_tipo,
    'conteudo_mudou', v_mudou,
    'variantes_descartadas', v_descartadas
  );
end;
$$;

revoke execute on function public.atualizar_pergunta(bigint, text, text, bigint, jsonb)
  from public, anon;
grant execute on function public.atualizar_pergunta(bigint, text, text, bigint, jsonb)
  to authenticated;
