-- Hardening (defesa em profundidade): remove de `authenticated` privilégios
-- que o RLS NÃO filtra e que o app nunca usa.
--
-- TRUNCATE/TRIGGER/REFERENCES não passam por RLS. Hoje não são alcançáveis
-- (o PostgREST não os expõe e o usuário não tem SQL bruto), mas não há motivo
-- para mantê-los concedidos. São grants padrão do Supabase.

revoke truncate, trigger, references
  on all tables in schema public
  from authenticated;

-- Catálogo público (banco de provas): a curadoria roda FORA do app, com a
-- service key. `authenticated` deve poder apenas LER. O RLS já bloqueia
-- escrita (só há policy de SELECT), mas remover o grant elimina a dependência
-- exclusiva do RLS — se uma policy de escrita fosse criada por engano, ainda
-- assim não haveria privilégio.
revoke insert, update, delete
  on public.catalogo_provas,
     public.catalogo_questoes,
     public.catalogo_alternativas
  from authenticated;
