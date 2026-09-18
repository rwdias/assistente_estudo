-- ===========================================================================
-- CRONOGRAMA SEMANAL ADAPTATIVO
--
-- O problema que esta migration resolve não é "o que estudar agora" (isso a
-- fila SM-2 do Aprendizado já responde), e sim **esquecer uma matéria**. Quem
-- estuda para concurso tem uma agenda com blocos GENÉRICOS ("estudar para o
-- concurso"), escolhe a matéria na hora e acaba escolhendo sempre as mesmas —
-- as outras somem do radar por semanas e o buraco só aparece perto da prova.
--
-- Por isso o sinal dominante aqui é COBERTURA (dias desde o último toque na
-- matéria), e não taxa de erro. Taxa de erro só desempata.
--
-- Duas ideias sustentam o desenho:
--
--   1. O plano aloca TEMPO e INTENÇÃO, nunca conteúdo. Um bloco diz
--      "Redes e Segurança — revisão", e QUAIS itens cair dentro dele quem
--      resolve é a fila, no momento em que o usuário senta. Plano que nomeia
--      item nasce desatualizado, porque a fila SM-2 de quinta não é a de
--      domingo, quando o plano foi gerado.
--
--   2. Regerar a semana é seguro e idempotente. O usuário reavalia toda
--      semana (e às vezes no meio dela); um gerador que duplicasse blocos ou
--      apagasse o que já foi cumprido tornaria a reavaliação perigosa, e ele
--      simplesmente pararia de usar.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Arquivar trilha
--
-- Quando uma trilha termina (certificação concluída, semestre encerrado), o
-- conteúdo dela não pode sumir — mas os milhares de itens vencidos precisam
-- sair de TODA contagem de pendência, senão poluem o dashboard e, pior,
-- entrariam no rodízio do cronograma roubando blocos de quem ainda importa.
--
-- Mesmo estilo de `perguntas.oculta` (0024): soft-hide, não delete.
-- Não precisa de grant novo — `authenticated` já tem UPDATE em `trilhas` e a
-- policy `trilhas_update` (dono) cobre a coluna nova.
-- ---------------------------------------------------------------------------
alter table public.trilhas
  add column arquivada boolean not null default false;

-- Índice parcial: as consultas filtram "não arquivadas"; indexar só as
-- arquivadas (minoria) é barato e suficiente para o filtro.
create index ix_trilhas_arquivada on public.trilhas (arquivada) where arquivada;


-- ---------------------------------------------------------------------------
-- 2. resumo_materias: passa a conhecer trilha arquivada
--
-- Mesmo cuidado que a 0025 teve de ter com `perguntas.oculta`: uma flag nova
-- que esconde conteúdo precisa ser refletida em TODA função que agrega, senão
-- o número da tela diverge do número da fila.
--
-- Decisão: a matéria de trilha arquivada continua na lista, com os TOTAIS
-- preservados (ele ainda pode querer consultar o conteúdo), mas com as
-- PENDÊNCIAS zeradas. Some a linha seria pior: o front faz
-- `Estado.materias.find(...)` no cronômetro, no header e no título — matéria
-- ausente quebraria essas telas.
--
-- Muda o tipo de retorno, então exige DROP antes do CREATE.
-- ---------------------------------------------------------------------------
drop function if exists public.resumo_materias();

create function public.resumo_materias()
returns table (
  id bigint,
  nome varchar,
  tipo varchar,
  trilha_id bigint,
  trilha_nome varchar,
  trilha_arquivada boolean,
  total_perguntas bigint,
  total_flashcards bigint,
  devidas_revisao bigint,
  a_aprender bigint,
  a_revisar bigint
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
    m.trilha_id,
    t.nome as trilha_nome,
    coalesce(t.arquivada, false) as trilha_arquivada,
    count(p.id) filter (where p.tipo = 'pergunta') as total_perguntas,
    count(p.id) filter (where p.tipo = 'flashcard') as total_flashcards,
    -- As três contagens de pendência zeram quando a trilha está arquivada:
    -- é exatamente o efeito desejado (tirar a dívida morta da frente).
    case when coalesce(t.arquivada, false) then 0 else count(p.id) filter (
      where p.tipo in ('pergunta', 'flashcard') and not p.oculta
        and (rp.proxima_revisao_em is null or rp.proxima_revisao_em <= now())
    ) end as devidas_revisao,
    -- "a aprender": nunca respondido (novo)
    case when coalesce(t.arquivada, false) then 0 else count(p.id) filter (
      where p.tipo in ('pergunta', 'flashcard') and not p.oculta
        and coalesce(rp.vezes_respondida, 0) = 0
    ) end as a_aprender,
    -- "a revisar": já respondido e com a revisão vencida
    case when coalesce(t.arquivada, false) then 0 else count(p.id) filter (
      where p.tipo in ('pergunta', 'flashcard') and not p.oculta
        and coalesce(rp.vezes_respondida, 0) > 0
        and rp.proxima_revisao_em <= now()
    ) end as a_revisar
  from public.materias m
  left join public.trilhas t on t.id = m.trilha_id
  left join public.subdivisoes s on s.materia_id = m.id
  left join public.perguntas p on p.subdivisao_id = s.id
  left join public.revisoes_perguntas rp on rp.pergunta_id = p.id
  where m.usuario_id = (select auth.uid())
  group by m.id, m.nome, m.tipo, m.trilha_id, t.nome, t.arquivada
  order by t.nome asc nulls last, m.nome asc;
$$;

revoke execute on function public.resumo_materias() from public, anon;
grant execute on function public.resumo_materias() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. grade_estudo — a rotina FIXA do usuário
--
-- Guarda "que horas, em que dia da semana, alimentado por qual trilha". É a
-- CAPACIDADE; o plano semanal é o preenchimento dela.
--
-- Por que tabela dedicada e não um jsonb em `perfis`: (a) `perfis` tem grant
-- de UPDATE POR COLUNA justamente porque guarda `ia_limite_diario`, e abrir
-- grant novo ali amplia a superfície da tabela mais sensível do schema;
-- (b) jsonb não tem FK, então trilha apagada deixaria id órfão em silêncio;
-- (c) `check` de dia/duração é grátis em coluna e impossível em jsonb.
--
-- ATENÇÃO — o `on delete cascade` em `trilha_id` CONTRARIA de propósito a
-- convenção de `materias.trilha_id` (que é `set null`). Lá a trilha é uma
-- etiqueta de organização e a matéria sobrevive sem ela. Aqui o slot **é**
-- "esta trilha alimenta este horário": slot sem trilha não significa nada e
-- não teria como ser preenchido, então some junto.
-- ---------------------------------------------------------------------------
create table public.grade_estudo (
  id bigint generated by default as identity primary key,
  usuario_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- isodow: 1 = segunda ... 7 = domingo (mesma convenção de extract(isodow))
  dia_semana smallint not null check (dia_semana between 1 and 7),
  hora_inicio time not null,
  duracao_minutos smallint not null default 60 check (duracao_minutos between 15 and 480),
  trilha_id bigint not null references public.trilhas (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Um horário só pode ter um dono de slot: sem isso, dois slots no mesmo
  -- minuto gerariam dois blocos disputando a mesma chave em blocos_plano.
  constraint uq_grade_slot unique (usuario_id, dia_semana, hora_inicio)
);
create index ix_grade_estudo_usuario on public.grade_estudo (usuario_id);

alter table public.grade_estudo enable row level security;

create policy grade_estudo_select on public.grade_estudo
  for select to authenticated
  using (usuario_id = (select auth.uid()));
-- WITH CHECK composto (mesmo padrão de sessoes_estudo_insert, 0030): além de
-- exigir que a linha seja do usuário, exige que a TRILHA referenciada seja
-- dele. Sem isso, um usuário poderia apontar um slot para a trilha de outro —
-- IDOR de escrita, que vazaria os nomes das matérias alheias no plano gerado.
create policy grade_estudo_insert on public.grade_estudo
  for insert to authenticated
  with check (usuario_id = (select auth.uid()) and exists (
    select 1 from public.trilhas t where t.id = trilha_id and t.usuario_id = (select auth.uid())
  ));
create policy grade_estudo_update on public.grade_estudo
  for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()) and exists (
    select 1 from public.trilhas t where t.id = trilha_id and t.usuario_id = (select auth.uid())
  ));
create policy grade_estudo_delete on public.grade_estudo
  for delete to authenticated
  using (usuario_id = (select auth.uid()));

-- Hardening da 0012 repetido para a tabela NOVA: o `revoke ... on all tables`
-- de lá só valeu para as que existiam na época. `anon` não recebe nada.
revoke all on public.grade_estudo from anon, public, authenticated;
grant select, insert, update, delete on public.grade_estudo to authenticated;


-- ---------------------------------------------------------------------------
-- 4. blocos_plano — o plano da semana, já materializado
--
-- Uma tabela só. Uma `planos_semana` separada teria apenas campos deriváveis
-- (a semana é `date_trunc('week', data)`), custando uma junção e mais RLS
-- para não guardar informação nenhuma.
--
-- O que deliberadamente NÃO é coluna, porque é derivável e envelheceria mal:
--   · `semana`         -> date_trunc('week', data)
--   · `trilha_id`      -> vem de materias
--   · `concluido bool` -> `concluido_em` já responde "se" e "quando"
--   · prioridade / dias_sem_toque -> envelhecem em 24h; o painel calcula ao vivo
-- ---------------------------------------------------------------------------
create table public.blocos_plano (
  id bigint generated by default as identity primary key,
  usuario_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data date not null,
  hora_inicio time not null,
  duracao_minutos smallint not null default 60 check (duracao_minutos between 15 and 480),
  materia_id bigint not null references public.materias (id) on delete cascade,
  -- A intenção é DERIVADA do estado da matéria na hora da geração:
  --   ingestao   = matéria sem nenhum item (precisa criar material, não revisar)
  --   revisao    = tem fila vencida
  --   exercicios = está em dia
  intencao text not null check (intencao in ('ingestao', 'revisao', 'exercicios')),
  concluido_em timestamptz,
  origem_conclusao text check (origem_conclusao in ('manual', 'cronometro')),
  created_at timestamptz not null default now(),
  -- O CORAÇÃO DA IDEMPOTÊNCIA: regerar a semana é um upsert por (dia, hora),
  -- então nunca duplica um bloco. Ver gerar_plano_semana.
  constraint uq_bloco_slot unique (usuario_id, data, hora_inicio)
);
create index ix_blocos_plano_usuario_data on public.blocos_plano (usuario_id, data);

alter table public.blocos_plano enable row level security;

create policy blocos_plano_select on public.blocos_plano
  for select to authenticated
  using (usuario_id = (select auth.uid()));
-- WITH CHECK composto: a matéria referenciada tem de ser do próprio usuário.
create policy blocos_plano_insert on public.blocos_plano
  for insert to authenticated
  with check (usuario_id = (select auth.uid()) and exists (
    select 1 from public.materias m where m.id = materia_id and m.usuario_id = (select auth.uid())
  ));
create policy blocos_plano_update on public.blocos_plano
  for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()) and exists (
    select 1 from public.materias m where m.id = materia_id and m.usuario_id = (select auth.uid())
  ));
create policy blocos_plano_delete on public.blocos_plano
  for delete to authenticated
  using (usuario_id = (select auth.uid()));

revoke all on public.blocos_plano from anon, public, authenticated;
grant select, insert, update, delete on public.blocos_plano to authenticated;


-- ---------------------------------------------------------------------------
-- 5. panorama_materias_cronograma — a fonte de verdade da COBERTURA
--
-- Fonte ÚNICA do gerador e do painel "matérias esfriando" (duas fórmulas de
-- "há quanto tempo não estudo isso" divergiriam com o tempo).
--
-- `ultimo_toque` combina as duas maneiras de tocar numa matéria:
--   · responder item  -> revisoes_perguntas.ultima_respondida_em
--   · rodar cronômetro -> sessoes_estudo.fim
-- GREATEST ignora NULL (só devolve NULL se ambos forem), que é exatamente o
-- comportamento desejado para quem usa só um dos dois caminhos.
--
-- `revisoes_perguntas` não tem materia_id — o vínculo é a cadeia
-- revisoes -> perguntas -> subdivisoes -> materias (mesmo join de resumo_materias).
-- ---------------------------------------------------------------------------
create function public.panorama_materias_cronograma()
returns table (
  id bigint,
  nome varchar,
  trilha_id bigint,
  trilha_nome varchar,
  trilha_arquivada boolean,
  total_itens bigint,
  vencidos bigint,
  respondidas bigint,
  erradas bigint,
  ultimo_toque timestamptz,
  dias_sem_toque integer
)
language sql
security invoker
set search_path = ''
stable
as $$
  with itens as (
    select
      m.id as materia_id,
      count(p.id) filter (
        where p.tipo in ('pergunta', 'flashcard') and not p.oculta
      ) as total_itens,
      count(p.id) filter (
        where p.tipo in ('pergunta', 'flashcard') and not p.oculta
          and (rp.proxima_revisao_em is null or rp.proxima_revisao_em <= now())
      ) as vencidos,
      coalesce(sum(rp.vezes_respondida), 0) as respondidas,
      coalesce(sum(rp.vezes_errada), 0) as erradas,
      max(rp.ultima_respondida_em) as ultima_resposta
    from public.materias m
    left join public.subdivisoes s on s.materia_id = m.id
    left join public.perguntas p on p.subdivisao_id = s.id
    left join public.revisoes_perguntas rp on rp.pergunta_id = p.id
    where m.usuario_id = (select auth.uid())
    group by m.id
  ),
  tempo as (
    select se.materia_id, max(se.fim) as ultima_sessao
    from public.sessoes_estudo se
    where se.usuario_id = (select auth.uid())
    group by se.materia_id
  )
  select
    m.id,
    m.nome,
    m.trilha_id,
    t.nome as trilha_nome,
    coalesce(t.arquivada, false) as trilha_arquivada,
    i.total_itens,
    i.vencidos,
    i.respondidas,
    i.erradas,
    greatest(i.ultima_resposta, te.ultima_sessao) as ultimo_toque,
    -- Matéria NUNCA tocada vira 9999 (e não NULL) para entrar na frente de
    -- tudo no rodízio: é literalmente a matéria que corre mais risco de ser
    -- esquecida. Datas comparadas no fuso local — o dia do usuário é o que vale.
    coalesce(
      (date_trunc('day', now() at time zone 'America/Sao_Paulo'))::date
        - (greatest(i.ultima_resposta, te.ultima_sessao) at time zone 'America/Sao_Paulo')::date,
      9999
    )::integer as dias_sem_toque
  from public.materias m
  join itens i on i.materia_id = m.id
  left join public.trilhas t on t.id = m.trilha_id
  left join tempo te on te.materia_id = m.id
  where m.usuario_id = (select auth.uid());
$$;

revoke all on function public.panorama_materias_cronograma() from public, anon;
grant execute on function public.panorama_materias_cronograma() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. gerar_plano_semana — o rodízio
--
-- REGRA DURA: nenhuma matéria ganha um segundo bloco na semana enquanto
-- houver matéria da mesma trilha ainda não escalada. Só depois disso a
-- prioridade (atraso + erro + fila vencida) decide quem repete.
--
-- A regra dura é implementada sem laço, por aritmética: as matérias da trilha
-- são RANQUEADAS 1..n e os slots NUMERADOS 1..k em ordem cronológica; o slot
-- `pos` recebe a matéria de rank `((pos-1) % n) + 1`. Um ciclo completo passa
-- por todas antes de repetir qualquer uma — que é a definição de cobertura.
--
-- O ranking começa por `vezes_fixas asc`: quem JÁ tem bloco imutável na semana
-- (passado ou concluído) vai para o fim da fila. Sem isso, regerar na quarta
-- reescalaria quem já foi estudado na segunda e deixaria alguém de fora.
--
-- Sobre o sábado ser "reposição": não há caso especial. Como os slots são
-- numerados em ordem cronológica, os de sábado caem na SEGUNDA volta do ciclo,
-- indo para os ranks mais altos — ou seja, quem tem mais `dias_sem_toque`.
-- E `dias_sem_toque` só baixa quando o usuário estuda DE VERDADE (responde ou
-- cronometra), nunca por ter sido escalado. Então a matéria escalada na segunda
-- e não cumprida continua no topo e volta naturalmente no sábado.
-- ---------------------------------------------------------------------------
create function public.gerar_plano_semana(p_inicio date default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hoje date := (date_trunc('day', now() at time zone 'America/Sao_Paulo'))::date;
  v_seg date;
  v_fim date;
  v_gravados integer;
begin
  -- date_trunc('week') no Postgres devolve SEGUNDA-feira, que é a convenção
  -- da grade (dia_semana isodow 1..7).
  v_seg := coalesce(p_inicio, (date_trunc('week', v_hoje::timestamp))::date);
  v_fim := v_seg + 6;

  -- Slot que saiu da grade deixa bloco órfão no plano. Limpa só o que ainda é
  -- reescrevível: futuro e não concluído. O passado é histórico, não se mexe.
  delete from public.blocos_plano b
  where b.usuario_id = v_uid
    and b.data between v_seg and v_fim
    and b.data >= v_hoje
    and b.concluido_em is null
    and not exists (
      select 1 from public.grade_estudo g
      where g.usuario_id = v_uid
        and (v_seg + (g.dia_semana - 1))::date = b.data
        and g.hora_inicio = b.hora_inicio
    );

  with slots as (
    -- A grade (dia da semana) vira datas concretas desta semana. Só o futuro:
    -- reescrever o passado apagaria o histórico do que ele realmente fez.
    select
      (v_seg + (g.dia_semana - 1))::date as data,
      g.hora_inicio,
      g.duracao_minutos,
      g.trilha_id
    from public.grade_estudo g
    where g.usuario_id = v_uid
      and (v_seg + (g.dia_semana - 1))::date >= v_hoje
  ),
  fixos as (
    -- Blocos que a geração NÃO vai reescrever (passado ou já cumprido).
    -- Contam como cobertura garantida e empurram a matéria para o fim da fila.
    select b.materia_id, count(*) as vezes
    from public.blocos_plano b
    where b.usuario_id = v_uid
      and b.data between v_seg and v_fim
      and (b.data < v_hoje or b.concluido_em is not null)
    group by b.materia_id
  ),
  ranking as (
    select
      pan.id as materia_id,
      pan.trilha_id,
      row_number() over (
        partition by pan.trilha_id
        order by
          -- 1º COBERTURA (regra dura): quem já tem bloco fixo na semana desce.
          coalesce(f.vezes, 0) asc,
          -- 2º prioridade, só para desempatar:
          --    2x atraso (satura em 30 dias) + 1x taxa de erro + 1x fila vencida.
          --    Taxa de erro com suavização de Laplace (erradas+1)/(respondidas+2),
          --    a mesma de taxaErroSuavizada no front — sem ela "1 erro de 1"
          --    passaria na frente de "20 de 50".
          ( 2.0 * least(pan.dias_sem_toque, 30) / 30.0
          + 1.0 * (pan.erradas + 1)::numeric / (pan.respondidas + 2)
          + 1.0 * least(pan.vencidos, 100) / 100.0 ) desc,
          -- 3º id: desempate determinístico, para que regerar sem mudança de
          -- estado produza exatamente o mesmo plano.
          pan.id asc
      ) as posicao,
      count(*) over (partition by pan.trilha_id) as total,
      case
        when pan.total_itens = 0 then 'ingestao'
        when pan.vencidos > 0 then 'revisao'
        else 'exercicios'
      end as intencao
    from public.panorama_materias_cronograma() pan
    left join fixos f on f.materia_id = pan.id
    where pan.trilha_id is not null
      and not pan.trilha_arquivada
  ),
  slots_numerados as (
    select s.*, row_number() over (
      partition by s.trilha_id order by s.data, s.hora_inicio
    ) as pos
    from slots s
  ),
  atribuido as (
    select sn.data, sn.hora_inicio, sn.duracao_minutos, r.materia_id, r.intencao
    from slots_numerados sn
    join ranking r
      on r.trilha_id = sn.trilha_id
     and r.posicao = ((sn.pos - 1) % r.total) + 1
  )
  insert into public.blocos_plano
    (usuario_id, data, hora_inicio, duracao_minutos, materia_id, intencao)
  select v_uid, a.data, a.hora_inicio, a.duracao_minutos, a.materia_id, a.intencao
  from atribuido a
  on conflict (usuario_id, data, hora_inicio) do update
    set materia_id = excluded.materia_id,
        intencao = excluded.intencao
    -- Este WHERE é o que torna "regerar" seguro: bloco já cumprido é intocável.
    where public.blocos_plano.concluido_em is null;

  get diagnostics v_gravados = row_count;
  return v_gravados;
end;
$$;

revoke all on function public.gerar_plano_semana(date) from public, anon;
grant execute on function public.gerar_plano_semana(date) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. alternar_conclusao_bloco — marcar/desmarcar "estudei isto"
--
-- Por que conclusão MANUAL e não derivada do cronômetro: `sessoes_estudo` tinha
-- 3 sessões no total quando este cronograma foi desenhado — o cronômetro ainda
-- não é hábito. Derivar a conclusão só dele deixaria o plano eternamente vazio,
-- e um plano que nunca mostra progresso é abandonado na segunda semana.
-- (A marcação automática pelo tempo cronometrado é uma camada por cima, futura;
-- por isso `origem_conclusao` já existe, distinguindo as duas procedências.)
--
-- Alterna em vez de só concluir: errar o clique não pode travar o bloco.
-- ---------------------------------------------------------------------------
create function public.alternar_conclusao_bloco(p_id bigint, p_origem text default 'manual')
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  update public.blocos_plano b
  set concluido_em = case when b.concluido_em is null then now() else null end,
      origem_conclusao = case when b.concluido_em is null then p_origem else null end
  where b.id = p_id
    -- Redundante com o RLS, mas explícito: nunca alternar bloco de outro.
    and b.usuario_id = (select auth.uid())
  returning b.concluido_em;
$$;

revoke all on function public.alternar_conclusao_bloco(bigint, text) from public, anon;
grant execute on function public.alternar_conclusao_bloco(bigint, text) to authenticated;
