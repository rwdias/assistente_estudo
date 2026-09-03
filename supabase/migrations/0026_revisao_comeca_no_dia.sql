-- A revisão deve VENCER NO COMEÇO DO DIA, não na hora em que se estudou.
--
-- Sintoma: quem estudou às 15h só via o item reaparecer às 15h do dia seguinte —
-- estudar de manhã ficava impossível, porque a fila só "abria" à tarde. A causa
-- estava em `adiciona_dias_uteis`, que somava os dias mas PRESERVAVA a hora
-- local do momento do estudo (`d + local::time`).
--
-- Agora a função devolve a MEIA-NOITE (America/Sao_Paulo) do dia útil alvo: o
-- item está disponível desde o primeiro minuto do dia em que vence. O número de
-- dias do intervalo não muda — só o horário dentro do dia.
--
-- O lapso de erro (+10 minutos) NÃO passa por aqui: `registrar_resposta` usa
-- `now() + interval '10 minutes'` direto, em tempo corrido. Isso é essencial —
-- truncar o lapso para meia-noite jogaria para o dia seguinte um item que
-- precisa voltar ainda na mesma sessão.

create or replace function public.adiciona_dias_uteis(base timestamptz, dias integer)
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
  -- Antes: `d + local::time` (mesma hora do estudo). Agora: início do dia.
  -- `d + time '00:00'` mantém o resultado como `timestamp` SEM fuso, que é o
  -- que `AT TIME ZONE` precisa para interpretar "meia-noite EM São Paulo".
  -- Escrever só `d at time zone ...` faria o Postgres castar o date para
  -- timestamptz e converter duas vezes, devolvendo a hora errada.
  return (d + time '00:00') at time zone 'America/Sao_Paulo';
end;
$$;

-- Normaliza o que JÁ estava agendado com a hora do estudo: mesma DATA, mas
-- valendo desde o começo do dia. Escopo restrito a itens com intervalo em DIAS
-- (intervalo_dias > 0); lapsos pendentes (intervalo_dias = 0, +10min) ficam
-- intactos, senão sumiriam da sessão em andamento.
update public.revisoes_perguntas
set proxima_revisao_em =
      date_trunc('day', proxima_revisao_em at time zone 'America/Sao_Paulo')
      at time zone 'America/Sao_Paulo'
where proxima_revisao_em is not null
  and intervalo_dias > 0;
