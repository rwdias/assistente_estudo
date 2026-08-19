-- Hardening de atualizar_pergunta: limites de tamanho no servidor.
--
-- Achado de auditoria: os tetos (6 alternativas no cliente, 8/1000 nas Edge
-- Functions) viviam FORA deste caminho de escrita. Chamando a RPC direto no
-- PostgREST, um usuário autenticado podia gravar milhares de alternativas ou
-- textos enormes na PRÓPRIA pergunta — bloat/DoS leve, sem barreira no
-- ponto de confiança. Aqui os limites passam a valer no próprio banco,
-- alinhados aos das outras funções (enunciado 4000, alternativa 1000, até 8).

create or replace function public.atualizar_pergunta(
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
  if length(p_enunciado) > 4000 then
    raise exception 'O enunciado é grande demais (máximo 4000 caracteres).';
  end if;
  if p_verso is not null and length(p_verso) > 4000 then
    raise exception 'O verso é grande demais (máximo 4000 caracteres).';
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
    if v_n_opcoes > 8 then
      raise exception 'Máximo de 8 alternativas.';
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
    if exists (
      select 1 from jsonb_array_elements(p_opcoes) e
      where length(coalesce(e->>'texto', '')) > 1000
    ) then
      raise exception 'Alternativa grande demais (máximo 1000 caracteres).';
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
