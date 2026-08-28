-- "Ocultar" um item (pergunta/flashcard): soft-hide para tirá-lo da REVISÃO e do
-- simulado sem apagá-lo. Diferente de excluir (delete) — o item continua na lista
-- de Perguntas, com badge, e pode ser reexibido. Motivo: o usuário quer parar de
-- ver um item na fila de estudo (ex.: já sabe de cor, ou é ruim) sem perder o
-- conteúdo. O filtro é no cliente (revisao.js/simulado.js); aqui só o estado.
--
-- Não precisa de grant novo: authenticated já tem UPDATE em perguntas, e a policy
-- perguntas_update (dono via subdivisão→matéria) cobre a mudança desta coluna —
-- ocultar não altera subdivisao_id, então USING e WITH CHECK continuam valendo.

alter table public.perguntas
  add column oculta boolean not null default false;

-- Índice parcial: as consultas de estudo filtram "não ocultas"; o índice só
-- indexa as ocultas (minoria), barato e útil para o filtro.
create index ix_perguntas_oculta on public.perguntas (oculta) where oculta;
