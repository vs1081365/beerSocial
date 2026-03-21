# Relatório Técnico — Cassandra na BeerSocial

---

## 1. Papel do Cassandra na Arquitetura

O Cassandra é utilizado para **dados com padrões de acesso de alta frequência e distribuídos**, onde a escalabilidade de escrita e a ordenação automática por tempo são fundamentais. Opera com um modelo **wide-column** — tabelas com partition key e clustering key — desenhadas especificamente para cada query.

Complementa o MongoDB (dados relacionais/documentais) e o Redis (cache/real-time), sendo responsável por:
- **Mensagens privadas** — volume elevado, acesso por par de utilizadores
- **Timeline/Feed** — fan-out de reviews para seguidores
- **Atividade de utilizador** — log sequencial por tempo
- **Rate limiting** — contadores distribuídos por ação
- **Seguidores/Following** — relações de seguimento

**Palavras-chave:** *wide-column store*, *query-first design*, *partition key*, *clustering key*, *linear write scalability*, *tunable consistency*, *LSM tree*, *compaction*

---

## 2. Keyspace e Configuração

```cql
CREATE KEYSPACE IF NOT EXISTS beersocial
WITH REPLICATION = {
    'class': 'SimpleStrategy',
    'replication_factor': 1
};
```

**`SimpleStrategy`** — adequado para desenvolvimento com um único datacenter. Em produção usaria-se `NetworkTopologyStrategy` com replication factor ≥ 3 por datacenter.

**`replication_factor: 1`** — em desenvolvimento; em produção seria ≥ 3 para tolerância a falhas.

---

## 3. Princípio Fundamental — Query-First Design

> No Cassandra, **a modelação começa pela query, não pelos dados**.

Ao contrário do modelo relacional (normalização → depois queries) ou documental (documento → depois queries), o Cassandra exige saber antecipadamente **como os dados vão ser lidos**.

**Regras:**
1. A **partition key** define em que nó os dados ficam armazenados — queries sem partition key fazem full scan (ineficiente)
2. A **clustering key** define a ordenação dentro da partição — é a forma de fazer `ORDER BY` sem custo
3. **Não existem JOINs** — dados necessários juntos são desnormalizados na mesma tabela
4. **Uma query por tabela** — se há 2 formas de aceder aos mesmos dados, criam-se 2 tabelas

**Palavras-chave:** *denormalization*, *data duplication*, *access pattern driven*, *no joins*, *no aggregations*

---

## 4. Tabelas — Modelação e Queries

### 4.1 Tabela `user_timeline` — Feed do Utilizador

**Query alvo:** "Obter o feed de reviews de um utilizador, ordenado por data, mais recente primeiro"

```cql
CREATE TABLE user_timeline (
    user_id    UUID,
    created_at TIMESTAMP,
    review_id  UUID,
    author_id  UUID,
    author_name TEXT,
    beer_id    UUID,
    beer_name  TEXT,
    beer_style TEXT,
    rating     DECIMAL,
    content    TEXT,
    likes_count    INT,
    comments_count INT,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND default_time_to_live = 604800;  -- TTL: 7 dias
```

**Análise da chave:**
| Componente | Campo | Propósito |
|-----------|-------|-----------|
| Partition Key | `user_id` | Cada utilizador tem a sua partição — todos os dados do feed num único nó |
| Clustering Key | `created_at DESC` | Ordena automaticamente por data, mais recente primeiro |

**TTL: 7 dias** — entradas do feed expiram automaticamente. Reduz armazenamento sem necessidade de jobs de limpeza.

**Padrão fan-out na escrita:** Quando um utilizador faz uma review, insere-se uma linha na `user_timeline` de **cada seguidor**:
```cql
-- Batch insert para N seguidores
BEGIN BATCH
  INSERT INTO user_timeline (user_id, created_at, review_id, author_id, author_name,
    beer_id, beer_name, beer_style, rating, content, likes_count, comments_count)
  VALUES (follower_1_uuid, now(), review_uuid, author_uuid, 'Ana', beer_uuid, 'Porto Lager', 'Lager', 4.5, '...', 0, 0);

  INSERT INTO user_timeline (user_id, ...) VALUES (follower_2_uuid, ...);
  -- ... para cada seguidor
APPLY BATCH;
```

**Query de leitura:**
```cql
SELECT * FROM user_timeline
WHERE user_id = <uuid>
LIMIT 20;
-- Não precisa de ORDER BY — clustering key já garante DESC
```

**Palavras-chave:** *fan-out on write*, *precomputed feed*, *TTL expiration*, *single partition read*

---

### 4.2 Tabela `messages` — Mensagens Privadas

**Query alvo:** "Obter todas as mensagens entre dois utilizadores, ordenadas cronologicamente"

```cql
CREATE TABLE messages (
    conversation_id TEXT,       -- hash determinístico de user1_id + user2_id
    created_at      TIMESTAMP,
    message_id      UUID,
    sender_id       TEXT,
    receiver_id     TEXT,
    sender_name     TEXT,
    content         TEXT,
    is_read         BOOLEAN,
    PRIMARY KEY (conversation_id, created_at)
) WITH CLUSTERING ORDER BY (created_at ASC);
```

**Análise da chave:**
| Componente | Campo | Propósito |
|-----------|-------|-----------|
| Partition Key | `conversation_id` | Todas as mensagens de uma conversa ficam na mesma partição |
| Clustering Key | `created_at ASC` | Ordem cronológica natural para mensagens |

**`conversation_id` determinístico:** gerado por ordenação alfabética dos dois IDs:
```typescript
// Garante que user_A + user_B e user_B + user_A produzem a mesma chave
const sorted = [userId1, userId2].sort();
const conversationId = `${sorted[0]}_${sorted[1]}`;
```

Esta abordagem garante que não há duplicação — a mesma conversa tem sempre o mesmo `conversation_id`, independentemente de quem inicia a query.

**Operações:**
```cql
-- Enviar mensagem
INSERT INTO messages
  (conversation_id, created_at, message_id, sender_id, receiver_id, sender_name, content, is_read)
  VALUES ('user_A_user_B', toTimestamp(now()), uuid(), 'user_A', 'user_B', 'Ana', 'Olá!', false);

-- Obter conversa (toda na mesma partição — O(1) acesso ao nó)
SELECT * FROM messages
WHERE conversation_id = 'user_A_user_B'
LIMIT 50;

-- Marcar mensagem como lida (update por primary key completa)
UPDATE messages SET is_read = true
WHERE conversation_id = 'user_A_user_B' AND created_at = <timestamp>;
```

**Nota importante:** No Cassandra, `UPDATE` com cláusula `WHERE` requer a primary key completa (`partition key + clustering key`). Não é possível fazer `UPDATE ... WHERE sender_id = X` sem a partition key — limitação fundamental que resulta do modelo de distribuição.

**Índices secundários** criados para queries por remetente:
```cql
CREATE INDEX idx_messages_sender_id   ON messages (sender_id);
CREATE INDEX idx_messages_receiver_id ON messages (receiver_id);
```

**Palavras-chave:** *deterministic partition key*, *append-only writes*, *secondary index*, *single partition query*

---

### 4.3 Tabela `notifications` — Notificações

**Query alvo:** "Obter notificações de um utilizador, mais recentes primeiro"

```cql
CREATE TABLE notifications (
    user_id         UUID,
    created_at      TIMESTAMP,
    notification_id UUID,
    type            TEXT,
    title           TEXT,
    message         TEXT,
    data            TEXT,   -- JSON serializado com contexto extra
    is_read         BOOLEAN,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND default_time_to_live = 2592000;  -- TTL: 30 dias
```

**TTL: 30 dias** — notificações expiram automaticamente. Sem necessidade de cron jobs de limpeza.

**Operações:**
```cql
-- Criar notificação
INSERT INTO notifications
  (user_id, created_at, notification_id, type, title, message, data, is_read)
  VALUES (<uuid>, toTimestamp(now()), uuid(), 'NEW_LIKE', 'Novo Like',
          'Ana gostou da tua review', '{"reviewId":"...","beerId":"..."}', false);

-- Obter notificações
SELECT * FROM notifications
WHERE user_id = <uuid>
LIMIT 20;

-- Marcar como lida
UPDATE notifications SET is_read = true
WHERE user_id = <uuid> AND created_at = <timestamp>;
```

**Palavras-chave:** *TTL-based cleanup*, *time-series data*, *wide row*

---

### 4.4 Tabela `user_activity` — Log de Atividade

**Query alvo:** "Obter o histórico de atividade de um utilizador"

```cql
CREATE TABLE user_activity (
    user_id       UUID,
    created_at    TIMESTAMP,
    activity_id   UUID,
    activity_type TEXT,     -- 'REVIEW', 'LIKE', 'COMMENT'
    beer_id       UUID,
    beer_name     TEXT,
    rating        DECIMAL,
    content       TEXT,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC);
```

Regista cada ação do utilizador (review, like, comentário) como uma entrada imutável. Padrão *append-only log* — nunca se atualiza ou apaga linhas, apenas se acrescentam.

```cql
-- Registar atividade
INSERT INTO user_activity
  (user_id, created_at, activity_id, activity_type, beer_id, beer_name, rating, content)
  VALUES (<uuid>, toTimestamp(now()), uuid(), 'REVIEW', <beer_uuid>, 'Porto Lager', 4.5, 'Excelente!');

-- Obter histórico
SELECT * FROM user_activity
WHERE user_id = <uuid>
LIMIT 50;
```

**Palavras-chave:** *append-only log*, *immutable records*, *event sourcing*, *audit trail*

---

### 4.5 Tabela `beer_reviews_index` — Índice Invertido

**Query alvo:** "Obter todas as reviews de uma cerveja específica"

```cql
CREATE TABLE beer_reviews_index (
    beer_id    UUID,
    created_at TIMESTAMP,
    review_id  UUID,
    user_id    UUID,
    user_name  TEXT,
    rating     DECIMAL,
    content    TEXT,
    PRIMARY KEY (beer_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC);
```

**Porquê esta tabela existe?** Na `user_timeline` os dados estão organizados por utilizador. Para obter reviews de uma cerveja seria necessário fazer full scan — ineficiente. Esta tabela é um **índice invertido manual** onde a partition key é a cerveja.

É um exemplo de **duplicação intencional de dados** em Cassandra — os dados da review existem tanto no MongoDB (persistência principal) como nesta tabela (acesso rápido por cerveja).

```cql
-- Indexar review ao criar
INSERT INTO beer_reviews_index
  (beer_id, created_at, review_id, user_id, user_name, rating, content)
  VALUES (<beer_uuid>, toTimestamp(now()), uuid(), <user_uuid>, 'Ana', 4.5, 'Ótima!');

-- Obter reviews de uma cerveja (single partition)
SELECT * FROM beer_reviews_index
WHERE beer_id = <beer_uuid>
LIMIT 20;
```

**Palavras-chave:** *inverted index*, *data duplication*, *denormalization*, *secondary access pattern*

---

### 4.6 Tabelas `followers` e `following` — Relações de Seguimento

**Duas tabelas para dois padrões de acesso distintos:**

```cql
-- "Quem me segue?"
CREATE TABLE followers (
    user_id      UUID,
    follower_id  UUID,
    follower_name TEXT,
    followed_at  TIMESTAMP,
    PRIMARY KEY (user_id, follower_id)
);

-- "Quem é que eu sigo?"
CREATE TABLE following (
    user_id        UUID,
    following_id   UUID,
    following_name TEXT,
    followed_at    TIMESTAMP,
    PRIMARY KEY (user_id, following_id)
);
```

Quando um utilizador segue outro, **ambas as tabelas são escritas em batch atómico**:
```cql
BEGIN BATCH
  INSERT INTO followers  (user_id, follower_id, follower_name, followed_at) VALUES (B, A, 'Ana', now());
  INSERT INTO following  (user_id, following_id, following_name, followed_at) VALUES (A, B, 'Bruno', now());
APPLY BATCH;
```

Este é o padrão clássico em Cassandra de **escrever duas vezes para ler uma** (*write duplication for read efficiency*).

```cql
-- Obter seguidores de um utilizador
SELECT * FROM followers WHERE user_id = <uuid> LIMIT 100;

-- Obter quem um utilizador segue
SELECT * FROM following WHERE user_id = <uuid> LIMIT 100;
```

**Palavras-chave:** *write duplication*, *dual-write pattern*, *batch atomicity*, *social graph*

---

### 4.7 Tabela `rate_limiting` — Contadores Distribuídos

**Query alvo:** "Verificar se um utilizador excedeu o limite de ações por janela de tempo"

```cql
CREATE TABLE rate_limiting (
    user_action   TEXT,      -- "userId:action" ex: "user_123:review"
    bucket_start  TIMESTAMP, -- início da janela temporal
    request_count COUNTER,   -- contador distribuído atómico
    PRIMARY KEY (user_action, bucket_start)
);
```

**`COUNTER`** é um tipo especial no Cassandra — suporta operações de incremento distribuídas e atómicas sem locks, usando o protocolo CAS (Compare-And-Set) internamente.

**Janela fixa por bucket temporal:**
```cql
-- Incrementar contador (atómico em ambiente distribuído)
UPDATE rate_limiting
SET request_count = request_count + 1
WHERE user_action = 'user_123:review' AND bucket_start = <hora_atual_arredondada>;

-- Verificar limite
SELECT request_count FROM rate_limiting
WHERE user_action = 'user_123:review' AND bucket_start = <hora_atual_arredondada>;
```

**Aplicado em:**
- Reviews: máximo 5 por hora por utilizador
- Comentários: máximo 20 por hora por utilizador

**Palavras-chave:** *distributed counter*, *COUNTER type*, *CAS*, *time-bucketed rate limiting*, *fixed window*

---

## 5. Resumo das Tabelas

| Tabela | Partition Key | Clustering Key | TTL | Propósito |
|--------|--------------|----------------|-----|-----------|
| `user_timeline` | `user_id` | `created_at DESC` | 7 dias | Feed de reviews por utilizador |
| `messages` | `conversation_id` | `created_at ASC` | Sem TTL | Mensagens de uma conversa |
| `notifications` | `user_id` | `created_at DESC` | 30 dias | Notificações por utilizador |
| `user_activity` | `user_id` | `created_at DESC` | Sem TTL | Log de atividade |
| `beer_reviews_index` | `beer_id` | `created_at DESC` | Sem TTL | Índice invertido de reviews |
| `followers` | `user_id` | `follower_id` | Sem TTL | Quem segue um utilizador |
| `following` | `user_id` | `following_id` | Sem TTL | A quem um utilizador segue |
| `rate_limiting` | `user_action` | `bucket_start` | Sem TTL | Contadores por ação/janela |

---

## 6. Padrões de Acesso por Operação

| Operação na App | Tabela Cassandra | Query |
|-----------------|-----------------|-------|
| Carregar feed | `user_timeline` | `WHERE user_id = ?` |
| Enviar mensagem | `messages` | `INSERT INTO messages` |
| Abrir chat | `messages` | `WHERE conversation_id = ?` |
| Ver notificações | `notifications` | `WHERE user_id = ?` |
| Ver histórico | `user_activity` | `WHERE user_id = ?` |
| Ver reviews de cerveja | `beer_reviews_index` | `WHERE beer_id = ?` |
| Aceitar amizade | `followers` + `following` | `INSERT` em ambas (BATCH) |
| Criar review | `user_timeline` | `BATCH INSERT` para cada seguidor |
| Rate limit de review | `rate_limiting` | `UPDATE ... count + 1` + `SELECT` |

---

## 7. Decisões de Modelação

1. **Query-first:** Cada tabela foi desenhada para uma query específica. Não há tabelas genéricas — cada padrão de acesso tem a sua estrutura.

2. **Duplicação intencional:** Os dados de reviews existem no MongoDB (fonte de verdade) e em 3 tabelas Cassandra (`user_timeline`, `beer_reviews_index`, `user_activity`). A duplicação é aceite em troca de leituras eficientes sem joins.

3. **TTL automático no feed e notificações:** Em vez de jobs de limpeza agendados, o TTL do Cassandra elimina automaticamente dados obsoletos — simpler operations, less moving parts.

4. **Batch atómico para dual-write:** Ao seguir um utilizador, `followers` e `following` são escritas num único `BATCH` — se uma falhar, ambas falham. Garante consistência entre as duas tabelas.

5. **COUNTER para rate limiting distribuído:** Permite incrementos concorrentes sem locks em ambiente multi-node — ao contrário de `SELECT + UPDATE` que teria race conditions.

6. **`conversation_id` determinístico:** Hash dos dois IDs ordenados alfabeticamente garante que a mesma conversa tem sempre a mesma partition key, independentemente de quem faz a query.

7. **UUID guard:** IDs do MongoDB são ObjectIds hexadecimais (ex: `507f1f77bcf86cd799439011`), não UUIDs. Todas as operações de escrita verificam o formato UUID antes de executar — evita erros `Invalid UUID string representation` em Cassandra.
