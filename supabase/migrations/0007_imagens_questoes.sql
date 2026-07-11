-- Imagens como parte das questões.
--
-- Os recortes das provas ficam no bucket público 'provas' do Storage
-- (upload SÓ pela ferramenta de curadoria, com service key — o bucket não
-- tem política de escrita para usuários). As tabelas guardam as URLs
-- públicas em jsonb; a importação copia as URLs (referência, não bytes),
-- então mil usuários com a mesma prova = 1 única cópia de cada imagem.

alter table public.catalogo_questoes add column imagens jsonb;
alter table public.perguntas add column imagens jsonb;

create or replace function public.importar_prova_catalogo(p_prova_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prova public.catalogo_provas%rowtype;
  v_materia_id bigint;
  v_sub_id bigint;
  v_q record;
  v_pergunta_id bigint;
  v_importadas integer := 0;
  v_puladas integer := 0;
begin
  select * into v_prova from public.catalogo_provas where id = p_prova_id;
  if not found then
    raise exception 'Prova % não encontrada no catálogo', p_prova_id;
  end if;

  insert into public.materias (usuario_id, nome)
  values (auth.uid(), v_prova.nome)
  on conflict (usuario_id, nome) do update set updated_at = now()
  returning id into v_materia_id;

  for v_q in
    select q.* from public.catalogo_questoes q
    where q.prova_id = p_prova_id
    order by q.numero nulls last, q.id
  loop
    insert into public.subdivisoes (materia_id, nome)
    values (v_materia_id, coalesce(v_q.topico, 'Geral'))
    on conflict (materia_id, nome) do update set updated_at = now()
    returning id into v_sub_id;

    if exists (
      select 1
      from public.perguntas p
      join public.subdivisoes s on s.id = p.subdivisao_id
      where s.materia_id = v_materia_id and p.enunciado = v_q.enunciado
    ) then
      v_puladas := v_puladas + 1;
      continue;
    end if;

    insert into public.perguntas (subdivisao_id, enunciado, dificuldade, origem, tipo, imagens)
    values (v_sub_id, v_q.enunciado, 'Média', 'catalogo', 'pergunta', v_q.imagens)
    returning id into v_pergunta_id;

    insert into public.opcoes (pergunta_id, texto, correta, ordem)
    select v_pergunta_id, a.texto, a.correta, a.ordem
    from public.catalogo_alternativas a
    where a.questao_id = v_q.id;

    insert into public.revisoes_perguntas (pergunta_id) values (v_pergunta_id);

    v_importadas := v_importadas + 1;
  end loop;

  return jsonb_build_object(
    'materia_id', v_materia_id,
    'materia_nome', v_prova.nome,
    'importadas', v_importadas,
    'puladas', v_puladas
  );
end;
$$;
