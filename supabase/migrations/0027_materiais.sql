-- MATERIAIS DA MATÉRIA: livros, PDFs, listas, slides — arquivos que o usuário
-- guarda junto da matéria a que pertencem.
--
-- Bucket PRIVADO (public = false), diferente do bucket `provas`: aqui vai
-- material pessoal e possivelmente protegido por direitos autorais, que não
-- pode ficar acessível por URL pública. O acesso é sempre por URL ASSINADA,
-- gerada sob demanda e com validade curta.
--
-- Caminho: {usuario_id}/{materia_id}/{arquivo}
-- O uid como PRIMEIRO segmento é o que torna a política simples e à prova de
-- IDOR: `storage.foldername(name)[1]` tem que ser o uid de quem chama, então
-- ninguém lê nem escreve na pasta de outro. O materia_id no segundo segmento
-- dá a "pasta por matéria" que o app lista.

insert into storage.buckets (id, name, public, file_size_limit)
values ('materiais', 'materiais', false, 52428800)  -- 50 MB por arquivo
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit;

-- Políticas: o dono da pasta (1º segmento = uid) faz tudo; mais ninguém vê nada.
-- Sem política para `anon`, então o bucket é invisível para quem não está logado.
drop policy if exists materiais_select on storage.objects;
create policy materiais_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists materiais_insert on storage.objects;
create policy materiais_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists materiais_update on storage.objects;
create policy materiais_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists materiais_delete on storage.objects;
create policy materiais_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'materiais'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
