-- Exercícios de lista têm SM-2, mas por ora são estudados no modo "resolver a
-- lista" (não na fila do Aprendizado). Para o contador "devidas de revisão" do
-- dashboard bater com a fila, ele deixa de contar tipo 'exercicio'. (Quando o
-- modo resolver integrar os errados à fila comum, revisitar.)
--
-- Só muda a expressão do `devidas_revisao`; o resto é idêntico à 0021.

create or replace function public.resumo_materias()
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
      where p.tipo in ('pergunta', 'flashcard')
        and (rp.proxima_revisao_em is null or rp.proxima_revisao_em <= now())
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
