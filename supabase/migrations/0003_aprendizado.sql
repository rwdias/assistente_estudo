-- "Aprendizado" como área principal: o resumo passa a separar, no estilo
-- Anki, os itens NOVOS ("a aprender", nunca respondidos) dos devidos para
-- revisão ("a revisar", já respondidos e com agendamento vencido).

drop function public.resumo_materias();

create function public.resumo_materias()
returns table (
  id bigint,
  nome varchar,
  total_perguntas bigint,
  total_flashcards bigint,
  a_aprender bigint,
  a_revisar bigint
)
language sql
security invoker
set search_path = ''
stable
as $$
  select
    m.id,
    m.nome,
    count(p.id) filter (where p.tipo = 'pergunta') as total_perguntas,
    count(p.id) filter (where p.tipo = 'flashcard') as total_flashcards,
    count(p.id) filter (
      where coalesce(rp.vezes_respondida, 0) = 0
    ) as a_aprender,
    count(p.id) filter (
      where rp.vezes_respondida > 0 and rp.proxima_revisao_em <= now()
    ) as a_revisar
  from public.materias m
  left join public.subdivisoes s on s.materia_id = m.id
  left join public.perguntas p on p.subdivisao_id = s.id
  left join public.revisoes_perguntas rp on rp.pergunta_id = p.id
  where m.usuario_id = (select auth.uid())
  group by m.id, m.nome
  order by m.nome asc;
$$;

revoke execute on function public.resumo_materias() from public, anon;
grant execute on function public.resumo_materias() to authenticated;
