-- Concursos: banca (fonte) e órgão/certame são coisas distintas, e o
-- NÍVEL vem do cargo (um mesmo edital tem cargos de médio e superior).
--   orgao: 'Banco do Brasil', 'Petrobras', ...   (vazio em vestibular)
--   cargo: 'Escriturário', 'Técnico...', ...     (vazio em vestibular)
-- 'nivel' continua na prova, agora inferido do cargo na curadoria.

alter table public.catalogo_provas add column orgao varchar(120);
alter table public.catalogo_provas add column cargo varchar(120);
