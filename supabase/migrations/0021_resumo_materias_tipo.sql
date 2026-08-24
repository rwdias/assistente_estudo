-- resumo_materias passa a devolver o `tipo` da matéria — o front precisa dele
-- para ligar o modo matemática (renderizar fórmula, formulários específicos)
-- só nas matérias 'matematica'. É a lista canônica de matérias do usuário.
--
-- Precisa DROP+CREATE (não CREATE OR REPLACE): mudou a assinatura de retorno
-- (coluna nova), e o Postgres não deixa trocar o RETURNS de uma função com
-- replace. O corpo é idêntico ao de 0002, só somando `m.tipo`.

drop function if exists public.resumo_materias();

create function public.resumo_materias()
returns table (
  id bigint,
  nome varchar,
  tipo varchar,
  total_perguntas bigint,
  total_flashcards bigint,
  devidas_revisao bigint
)
language sql
security invoker
set search_path = ''
stable
as $$
  select
    m.id,
    m.nome,
    m.tipo,
    count(p.id) filter (where p.tipo = 'pergunta') as total_perguntas,
    count(p.id) filter (where p.tipo = 'flashcard') as total_flashcards,
    count(p.id) filter (
      where rp.proxima_revisao_em is null or rp.proxima_revisao_em <= now()
    ) as devidas_revisao
  from public.materias m
  left join public.subdivisoes s on s.materia_id = m.id
  left join public.perguntas p on p.subdivisao_id = s.id
  left join public.revisoes_perguntas rp on rp.pergunta_id = p.id
  where m.usuario_id = (select auth.uid())
  group by m.id, m.nome, m.tipo
  order by m.nome asc;
$$;

revoke execute on function public.resumo_materias() from public, anon;
grant execute on function public.resumo_materias() to authenticated;
