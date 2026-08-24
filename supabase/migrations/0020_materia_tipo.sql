-- Tipo de matéria: separa "normal" (múltipla escolha, vestibular, concurso —
-- o que já existe) de "matematica" (modo novo: LaTeX/MathML, ingestão de livro,
-- drill paramétrico). A separação é dura de propósito: a matéria normal fica
-- 100% inalterada, e o modo matemática (renderização de fórmula etc.) só é
-- ligado nas matérias do tipo 'matematica'. Escolhido na criação.
--
-- Coluna não sensível → NÃO precisa mexer em RLS: as policies de `materias` já
-- filtram por dono, e o usuário tem grant de tabela inteira (pode setar `tipo`
-- no próprio insert). Default 'normal' mantém todas as matérias atuais como estão.

alter table public.materias
  add column tipo varchar(20) not null default 'normal'
    constraint materias_tipo_check check (tipo in ('normal', 'matematica'));
