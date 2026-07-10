-- Flashcards (estilo Anki) + contexto de edital por matéria.
--
-- Flashcards moram na MESMA tabela `perguntas`, com tipo='flashcard' e o
-- campo `verso` (a frente reutiliza `enunciado`). Assim toda a cadeia de
-- RLS, o vínculo com `revisoes_perguntas` e a função registrar_resposta
-- (SM-2) funcionam sem nenhuma duplicação. Flashcards não têm `opcoes`.

alter table public.perguntas
  add column tipo varchar(20) not null default 'pergunta'
    constraint perguntas_tipo_check check (tipo in ('pergunta', 'flashcard')),
  add column verso text;

-- Contexto em markdown usado pela IA ao gerar flashcards desta matéria
-- (ex.: trechos do edital, estilo de escrita desejado).
alter table public.materias
  add column contexto_ia text;

-- resumo_materias passa a separar perguntas de flashcards.
drop function public.resumo_materias();

create function public.resumo_materias()
returns table (
  id bigint,
  nome varchar,
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
  group by m.id, m.nome
  order by m.nome asc;
$$;

revoke execute on function public.resumo_materias() from public, anon;
grant execute on function public.resumo_materias() to authenticated;
