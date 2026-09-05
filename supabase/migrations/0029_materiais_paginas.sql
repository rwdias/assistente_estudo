-- Número de páginas do material, exibido na lista junto de título/autor/ano.
--
-- Não vem da IA: é dado objetivo do arquivo (`pdf.numPages`), lido pela Edge
-- Function `metadados_material` quando ela já tem o documento aberto. Sai fora
-- do schema do modelo de propósito — pedir para a IA "contar páginas" seria
-- convidar alucinação para algo que o parser sabe com certeza.

alter table public.materiais
  add column paginas integer;
