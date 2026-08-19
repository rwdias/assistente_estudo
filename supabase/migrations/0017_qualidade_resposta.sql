-- Avaliação em 4 níveis nos flashcards (estilo Anki): De novo / Difícil /
-- Bom / Fácil, em vez de só Errei/Acertei.
--
-- `registrar_resposta` ganha `p_qualidade` (2..5, SM-2 clássico):
--   2 = De novo  -> lapso: zera o intervalo e reagenda +10min
--   3 = Difícil  -> acerto fraco: volta MAIS CEDO que o Bom, e o EF cai
--   4 = Bom      -> progressão canônica (0 -> 1 -> 6 -> round(i * EF))
--   5 = Fácil    -> progressão do Bom com bônus, volta MAIS TARDE, EF sobe
--
-- Compatibilidade: `p_qualidade` é opcional. Quando vem NULL (perguntas de
-- múltipla escolha e simulado, que são objetivamente certo/errado) o
-- comportamento é EXATAMENTE o de antes — acerto=5 pela progressão canônica,
-- erro=2 com +10min. A SM-2 binária segue validada 1:1 contra o src/srs.py.
--
-- Precisa de DROP antes do CREATE: acrescentar um parâmetro com default cria
-- uma sobrecarga, e aí a chamada com 2 argumentos ficaria ambígua. Como as
-- duas coisas acontecem na mesma transação e a função nova aceita a chamada
-- antiga (2 args), o SPA que está no ar continua funcionando.

drop function if exists public.registrar_resposta(bigint, boolean);

create function public.registrar_resposta(
  p_pergunta_id bigint,
  p_correta boolean,
  p_qualidade integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.revisoes_perguntas%rowtype;
  q integer;
  novo_ef numeric;
  intervalo_bom integer;
  novo_intervalo integer;
  proxima timestamptz;
  novos_seguidos integer;
  v_correta boolean;
begin
  select * into r
  from public.revisoes_perguntas
  where pergunta_id = p_pergunta_id
  for update;

  if not found then
    raise exception 'Pergunta não encontrada.';
  end if;

  q := coalesce(p_qualidade, case when p_correta then 5 else 2 end);
  if q < 2 or q > 5 then
    raise exception 'Qualidade inválida.';
  end if;

  -- "De novo" conta como erro; Difícil/Bom/Fácil contam como acerto.
  v_correta := q >= 3;

  novo_ef := greatest(
    (r.fator_facilidade / 100.0) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
    1.3
  );

  if q <= 2 then
    novo_intervalo := 0;
    proxima := now() + interval '10 minutes';
  elsif q = 3 then
    -- Difícil: sempre volta antes do Bom. O +1 garante que saia do lugar
    -- mesmo com intervalo pequeno (1 dia * 1.2 arredondaria de volta p/ 1).
    novo_intervalo := case
      when r.intervalo_dias <= 0 then 1
      else greatest(r.intervalo_dias + 1, round(r.intervalo_dias * 1.2)::integer)
    end;
    proxima := now() + make_interval(days => novo_intervalo);
  else
    -- Progressão canônica (é também o caminho do "acertei" binário).
    intervalo_bom := case
      when r.intervalo_dias <= 0 then 1
      when r.intervalo_dias = 1 then 6
      else round(r.intervalo_dias * novo_ef)::integer
    end;

    if q = 5 and p_qualidade is not null then
      -- Fácil (só existe no modo 4 botões): bônus sobre o Bom. Cartão novo
      -- pula direto para 4 dias, como o "easy interval" do Anki.
      novo_intervalo := case
        when r.intervalo_dias <= 0 then 4
        else round(intervalo_bom * 1.3)::integer
      end;
    else
      novo_intervalo := intervalo_bom;
    end if;

    proxima := now() + make_interval(days => novo_intervalo);
  end if;

  novos_seguidos := case when v_correta then r.acertos_seguidos + 1 else 0 end;

  update public.revisoes_perguntas set
    vezes_respondida = r.vezes_respondida + 1,
    vezes_acertada = r.vezes_acertada + (case when v_correta then 1 else 0 end),
    vezes_errada = r.vezes_errada + (case when v_correta then 0 else 1 end),
    ultima_resposta_correta = v_correta,
    ultima_respondida_em = now(),
    fator_facilidade = round(novo_ef * 100)::integer,
    intervalo_dias = novo_intervalo,
    proxima_revisao_em = proxima,
    acertos_seguidos = novos_seguidos,
    updated_at = now()
  where pergunta_id = p_pergunta_id;

  return jsonb_build_object(
    'intervalo_dias', novo_intervalo,
    'proxima_revisao_em', proxima,
    'vezes_respondida', r.vezes_respondida + 1,
    'vezes_acertada', r.vezes_acertada + (case when v_correta then 1 else 0 end),
    'acertos_seguidos', novos_seguidos,
    'qualidade', q,
    'ultima_resposta_correta', v_correta
  );
end;
$$;

revoke execute on function public.registrar_resposta(bigint, boolean, integer) from public, anon;
grant execute on function public.registrar_resposta(bigint, boolean, integer) to authenticated;
