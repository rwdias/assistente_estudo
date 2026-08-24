-- Revisão espaçada em DIAS ÚTEIS: fins de semana e feriados nacionais não
-- entram na contagem dos intervalos. Objetivo: não acumular matéria depois de
-- um fim de semana/feriado — como nenhuma revisão cai em dia não-útil, não há
-- aquele monte de cartões vencidos de uma vez na segunda.
--
-- O que NÃO muda: a matemática do SM-2 (fator de facilidade, o número do
-- intervalo em si: 1 → 6 → round(i×EF), Difícil/Bom/Fácil). Só muda a DATA
-- derivada do intervalo: em vez de `now() + N dias corridos`, é
-- `now() + N dias úteis`. O reagendamento de +10min (lapso, dentro da sessão)
-- continua em tempo corrido — não faz sentido jogar um lapso para segunda.
--
-- Feriados: nacionais do Brasil, calculados. Fixos + móveis pela Páscoa
-- (Carnaval, Sexta-feira Santa, Corpus Christi). Não cobre estaduais/municipais.

-- Feriado nacional? (data no fuso local já resolvido pelo chamador)
create function public.eh_feriado_nacional(d date)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  ano int := extract(year from d)::int;
  mes int := extract(month from d)::int;
  dia int := extract(day from d)::int;
  -- variáveis do algoritmo de Páscoa (Meeus/Butcher, calendário gregoriano)
  a int; b int; c int; e int; f int; g int; h int; i int; k int; l int; mm int;
  pascoa_mes int; pascoa_dia int; pascoa date;
begin
  -- feriados nacionais FIXOS
  if (mes, dia) in (
    (1, 1),    -- Confraternização Universal
    (4, 21),   -- Tiradentes
    (5, 1),    -- Dia do Trabalho
    (9, 7),    -- Independência
    (10, 12),  -- Nossa Senhora Aparecida
    (11, 2),   -- Finados
    (11, 15),  -- Proclamação da República
    (11, 20),  -- Consciência Negra (nacional desde 2024)
    (12, 25)   -- Natal
  ) then
    return true;
  end if;

  -- Páscoa do ano
  a := ano % 19;
  b := ano / 100;
  c := ano % 100;
  e := b / 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - e - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * (b % 4) + 2 * i - h - k) % 7;
  mm := (a + 11 * h + 22 * l) / 451;
  pascoa_mes := (h + l - 7 * mm + 114) / 31;
  pascoa_dia := ((h + l - 7 * mm + 114) % 31) + 1;
  pascoa := make_date(ano, pascoa_mes, pascoa_dia);

  -- móveis relativos à Páscoa
  if d = pascoa - 47 then return true; end if;  -- Carnaval (terça)
  if d = pascoa - 2  then return true; end if;  -- Sexta-feira Santa
  if d = pascoa + 60 then return true; end if;  -- Corpus Christi

  return false;
end;
$$;

-- Soma `dias` dias ÚTEIS (pula sáb/dom e feriados) a partir de `base`,
-- preservando o horário. Resolve tudo no fuso America/Sao_Paulo, para que
-- "dia da semana" bata com o dia local do usuário. dias<=0 devolve base.
create function public.adiciona_dias_uteis(base timestamptz, dias integer)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local timestamp := base at time zone 'America/Sao_Paulo';
  d date := local::date;
  restantes int := dias;
begin
  if dias is null or dias <= 0 then
    return base;
  end if;
  while restantes > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6 and not public.eh_feriado_nacional(d) then
      restantes := restantes - 1;
    end if;
  end loop;
  return (d + local::time) at time zone 'America/Sao_Paulo';
end;
$$;

revoke execute on function public.eh_feriado_nacional(date) from public, anon;
revoke execute on function public.adiciona_dias_uteis(timestamptz, integer) from public, anon;
grant execute on function public.eh_feriado_nacional(date) to authenticated;
grant execute on function public.adiciona_dias_uteis(timestamptz, integer) to authenticated;

-- registrar_resposta: idêntica à 0017, exceto que a DATA da próxima revisão
-- passa a contar dias úteis (as duas linhas `proxima := now() + N dias`).
create or replace function public.registrar_resposta(
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

  v_correta := q >= 3;

  novo_ef := greatest(
    (r.fator_facilidade / 100.0) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
    1.3
  );

  if q <= 2 then
    -- lapso: dentro da sessão, tempo corrido (não pula p/ dia útil).
    novo_intervalo := 0;
    proxima := now() + interval '10 minutes';
  elsif q = 3 then
    novo_intervalo := case
      when r.intervalo_dias <= 0 then 1
      else greatest(r.intervalo_dias + 1, round(r.intervalo_dias * 1.2)::integer)
    end;
    proxima := public.adiciona_dias_uteis(now(), novo_intervalo);
  else
    intervalo_bom := case
      when r.intervalo_dias <= 0 then 1
      when r.intervalo_dias = 1 then 6
      else round(r.intervalo_dias * novo_ef)::integer
    end;

    if q = 5 and p_qualidade is not null then
      novo_intervalo := case
        when r.intervalo_dias <= 0 then 4
        else round(intervalo_bom * 1.3)::integer
      end;
    else
      novo_intervalo := intervalo_bom;
    end if;

    proxima := public.adiciona_dias_uteis(now(), novo_intervalo);
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
