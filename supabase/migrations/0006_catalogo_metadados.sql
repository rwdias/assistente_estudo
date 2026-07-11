-- Metadados livres por prova (urls oficiais, caderno, dia, modelo de IA)
-- e por questão (reservado p/ imagens no Storage etc.).

alter table public.catalogo_provas add column metadados jsonb;
alter table public.catalogo_questoes add column metadados jsonb;
