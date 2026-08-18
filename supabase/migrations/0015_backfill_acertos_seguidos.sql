-- Backfill de `acertos_seguidos` (criada zerada em 0014) a partir do estado
-- do SM-2, para que perguntas já treinadas não precisem recomeçar a contagem
-- do zero para ficarem elegíveis a variantes.
--
-- Não existe log de respostas — só contadores agregados. Mas neste SM-2 o
-- `intervalo_dias` é função direta da sequência de acertos desde o último
-- erro (o erro zera o intervalo e reagenda +10min):
--
--   streak 0 -> intervalo 0      (errou por último, ou nunca respondeu)
--   streak 1 -> intervalo 1
--   streak 2 -> intervalo 6
--   streak >= 3 -> intervalo round(6 * EF) >= 8
--
-- Ou seja, dá para INVERTER o intervalo e recuperar o streak. Para os dados
-- de hoje a reconstrução é exata: só ocorrem os intervalos 0, 1 e 6 — nenhum
-- valor fora da progressão e nenhuma linha incoerente (último acerto com
-- intervalo 0). Acima de 6 o intervalo depende do EF de cada item, então não
-- dá para saber o número exato: fica em 3, que é o piso compatível com o
-- intervalo (e já é o suficiente para o gatilho das variantes).
--
-- `vezes_acertada` NÃO serve como proxy: é acumulado e não zera no erro, então
-- inflaria o streak de quem alterna acerto e erro.
--
-- O filtro `acertos_seguidos = 0` preserva o que já foi contado de verdade
-- por `registrar_resposta` desde 0014.

update public.revisoes_perguntas set acertos_seguidos = case
  -- nunca respondida (null) ou errou por último
  when ultima_resposta_correta is not true then 0
  when intervalo_dias <= 0 then 0
  when intervalo_dias = 1 then 1
  -- 2..6: passou pelo degrau 1 -> 6, logo pelo menos 2 acertos seguidos
  when intervalo_dias <= 6 then 2
  else 3
end
where acertos_seguidos = 0;
