-- Camadas de classificação acima da fonte:
--   categoria: 'vestibular' | 'concurso' | 'certificacao' | 'enem' | ...
--   nivel: 'medio' | 'superior' | 'fundamental' | ...
-- Preenchidas pela curadoria; usadas como filtros no Simulado do banco.

alter table public.catalogo_provas add column categoria varchar(40);
alter table public.catalogo_provas add column nivel varchar(30);
