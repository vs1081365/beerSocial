# BeerSocial — Guia de Comandos das Bases de Dados

> Todos os comandos necessários para criar, popular e operar as 3 bases de dados **sem frontend**.

---

## ÍNDICE

1. [Arranque da Infraestrutura (Docker)](#1-arranque-da-infraestrutura-docker)
2. [MongoDB — Setup e Operações](#2-mongodb--setup-e-operações)
3. [Redis — Setup e Operações](#3-redis--setup-e-operações)
4. [Cassandra — Setup e Operações](#4-cassandra--setup-e-operações)
5. [Seeds — Popular com Dados de Teste](#5-seeds--popular-com-dados-de-teste)
6. [API HTTP — Testar Sem Frontend](#6-api-http--testar-sem-frontend)
7. [Verificação de Estado](#7-verificação-de-estado)

---

## 1. Arranque da Infraestrutura (Docker)

### Iniciar todos os serviços
```bash
docker-compose up -d
```

### Verificar estado dos containers
```bash
docker-compose ps
```

### Logs em tempo real
```bash
docker-compose logs -f
docker-compose logs -f redis
docker-compose logs -f mongodb
docker-compose logs -f cassandra
```

### Parar tudo
```bash
docker-compose down
```

### Apagar tudo (incluindo dados)
```bash
docker-compose down -v
```

### Serviços e portas
| Serviço | Porta | Credenciais |
|---------|-------|-------------|
| Redis | 6379 | sem autenticação |
| MongoDB | 27017 | beersocial / beersocial123 |
| Cassandra | 9042 (CQL) | sem autenticação |

---

## 2. MongoDB — Setup e Operações

### Conectar ao MongoDB
```bash
# Via mongosh no container
docker exec -it beersocial-mongodb mongosh \
  -u beersocial -p beersocial123 \
  --authenticationDatabase admin \
  beersocial

# Via mongosh local (se instalado)
mongosh "mongodb://beersocial:beersocial123@localhost:27017/beersocial?authSource=admin"
```

---

### Criar Base de Dados e Coleções

```javascript
// Selecionar a base de dados
use beersocial

// ============================================
// COLEÇÃO: users
// ============================================
db.createCollection('users')

db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ username: 1 }, { unique: true })

// ============================================
// COLEÇÃO: beers
// ============================================
db.createCollection('beers')

db.beers.createIndex({ name: 1 })
db.beers.createIndex({ brewery: 1 })
db.beers.createIndex({ style: 1 })
db.beers.createIndex({ createdBy: 1 })

// ============================================
// COLEÇÃO: reviews (com comments e likes embedded)
// ============================================
db.createCollection('reviews', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'beerId', 'rating', 'createdAt'],
      properties: {
        userId:   { bsonType: 'string' },
        beerId:   { bsonType: 'string' },
        rating:   { bsonType: 'number', minimum: 1, maximum: 5 },
        content:  { bsonType: 'string' },
        createdAt:{ bsonType: 'date' },
        comments: { bsonType: 'array' },
        likes:    { bsonType: 'array' }
      }
    }
  }
})

db.reviews.createIndex({ beerId: 1, createdAt: -1 })
db.reviews.createIndex({ userId: 1, createdAt: -1 })
db.reviews.createIndex({ userId: 1, beerId: 1 }, { unique: true })

// ============================================
// COLEÇÃO: friendships
// ============================================
db.createCollection('friendships')

db.friendships.createIndex({ requesterId: 1, addresseeId: 1 }, { unique: true })
db.friendships.createIndex({ addresseeId: 1, status: 1 })
db.friendships.createIndex({ requesterId: 1, status: 1 })

// ============================================
// COLEÇÃO: notifications
// ============================================
db.createCollection('notifications')

db.notifications.createIndex({ userId: 1, createdAt: -1 })
db.notifications.createIndex({ userId: 1, isRead: 1 })

// ============================================
// COLEÇÃO: conversations
// ============================================
db.createCollection('conversations')

db.conversations.createIndex({ participants: 1 })
db.conversations.createIndex({ updatedAt: -1 })
```

---

### Inserir Dados (Exemplos)

```javascript
// Inserir utilizador
db.users.insertOne({
  _id: "user_001",
  email: "ana@exemplo.pt",
  password: "pbkdf2_hashed_password",
  name: "Ana Silva",
  username: "anasilva",
  avatar: null,
  bio: "Apreciadora de IPAs",
  location: "Porto",
  favoriteBeer: "Super Bock Stout",
  createdAt: new Date(),
  updatedAt: new Date()
})

// Inserir cerveja
db.beers.insertOne({
  _id: "beer_001",
  name: "Porto Lager",
  brewery: "Cervejaria Invicta",
  style: "Lager",
  abv: 5.2,
  ibu: 18,
  description: "Uma lager suave com notas cítricas",
  country: "Portugal",
  createdBy: "user_001",
  createdAt: new Date(),
  updatedAt: new Date()
})

// Inserir review
db.reviews.insertOne({
  _id: "review_001",
  beerId: "beer_001",
  beerName: "Porto Lager",
  userId: "user_001",
  userName: "Ana Silva",
  rating: 4.5,
  content: "Excelente cerveja, muito refrescante!",
  comments: [],
  likes: [],
  createdAt: new Date(),
  updatedAt: new Date()
})

// Inserir pedido de amizade
db.friendships.insertOne({
  _id: "friend_001",
  requesterId: "user_001",
  requesterName: "Ana Silva",
  addresseeId: "user_002",
  addresseeName: "Bruno Costa",
  status: "PENDING",
  createdAt: new Date(),
  updatedAt: new Date()
})
```

---

### Queries de Consulta

```javascript
// Feed geral (todas as reviews, mais recentes primeiro)
db.reviews.find({}).sort({ createdAt: -1 }).limit(20).pretty()

// Reviews de uma cerveja
db.reviews.find({ beerId: "beer_001" }).sort({ createdAt: -1 })

// Reviews de um utilizador
db.reviews.find({ userId: "user_001" }).sort({ createdAt: -1 })

// Pesquisa de cervejas
db.beers.find({
  $or: [
    { name: { $regex: "lager", $options: "i" } },
    { brewery: { $regex: "invicta", $options: "i" } }
  ]
})

// Amigos aceites de um utilizador
db.friendships.find({
  $or: [
    { requesterId: "user_001", status: "ACCEPTED" },
    { addresseeId: "user_001", status: "ACCEPTED" }
  ]
})

// Pedidos pendentes recebidos
db.friendships.find({ addresseeId: "user_002", status: "PENDING" })

// Notificações não lidas
db.notifications.find({ userId: "user_001", isRead: false })
  .sort({ createdAt: -1 })

// Contagem de não lidas (badge)
db.notifications.countDocuments({ userId: "user_001", isRead: false })

// Média de rating por cerveja (Aggregation)
db.reviews.aggregate([
  { $match: { beerId: "beer_001" } },
  { $group: {
      _id: null,
      avgRating: { $avg: "$rating" },
      totalReviews: { $sum: 1 }
  }}
])
```

---

### Operações de Update

```javascript
// Adicionar comentário a uma review
db.reviews.updateOne(
  { _id: "review_001" },
  {
    $push: {
      comments: {
        userId: "user_002",
        userName: "Bruno Costa",
        content: "Concordo!",
        createdAt: new Date()
      }
    },
    $set: { updatedAt: new Date() }
  }
)

// Dar like (evita duplicados)
db.reviews.updateOne(
  { _id: "review_001", likes: { $ne: "user_002" } },
  { $push: { likes: "user_002" }, $set: { updatedAt: new Date() } }
)

// Remover like
db.reviews.updateOne(
  { _id: "review_001" },
  { $pull: { likes: "user_002" }, $set: { updatedAt: new Date() } }
)

// Aceitar pedido de amizade
db.friendships.updateOne(
  { _id: "friend_001" },
  { $set: { status: "ACCEPTED", updatedAt: new Date() } }
)

// Marcar todas as notificações como lidas
db.notifications.updateMany(
  { userId: "user_001", isRead: false },
  { $set: { isRead: true } }
)
```

---

### Verificar Indexes

```javascript
// Ver todos os indexes de uma coleção
db.reviews.getIndexes()
db.users.getIndexes()
db.friendships.getIndexes()
```

---

## 3. Redis — Setup e Operações

### Conectar ao Redis
```bash
# Via redis-cli no container
docker exec -it beersocial-redis redis-cli

# Via redis-cli local (se instalado)
redis-cli -h localhost -p 6379
```

---

### Sessões de Utilizador (Hash)

```bash
# Criar sessão
HSET session:sess_abc123  userId "user_001"  email "ana@exemplo.pt"  name "Ana Silva"  createdAt "1710000000000"  lastAccess "1710000000000"
EXPIRE session:sess_abc123 86400

# Ler sessão
HGETALL session:sess_abc123

# Atualizar último acesso
HSET session:sess_abc123 lastAccess "1710001000000"

# Apagar sessão (logout)
DEL session:sess_abc123

# Listar todas as sessões ativas
KEYS session:*
```

---

### Cache de Queries (String com TTL)

```bash
# Guardar resultado em cache (60 segundos)
SET cache:beers:list '{"beers":[{"id":"beer_001","name":"Porto Lager"}]}' EX 60

# Ler da cache
GET cache:beers:list

# Invalidar cache de uma cerveja
DEL cache:reviews:beer_001

# Invalidar por padrão (apaga tudo que começa com cache:beers:)
# Nota: KEYS é lento em produção — usar SCAN
KEYS cache:beers:*

# Verificar TTL restante
TTL cache:beers:list
```

---

### Contadores Atómicos (INCR/DECR)

```bash
# Incrementar likes
INCR counter:beer:beer_001:likes

# Decrementar
DECR counter:beer:beer_001:likes

# Ler valor atual
GET counter:beer:beer_001:likes

# Incrementar com TTL inicial
INCR counter:beer:beer_001:views
EXPIRE counter:beer:beer_001:views 86400
```

---

### Views por Dia — Trending (Hash)

```bash
# Registar view de cerveja
HINCRBY views:beer:2026-03-20 beer_001 1
HINCRBY views:beer:2026-03-20 beer_002 3

# Ver todas as views do dia (para calcular trending)
HGETALL views:beer:2026-03-20

# Ver views de uma cerveja específica
HGET views:beer:2026-03-20 beer_001

# TTL de 7 dias
EXPIRE views:beer:2026-03-20 604800
```

---

### Leaderboards (Sorted Set)

```bash
# Atualizar rating de cerveja
ZADD lb:beers:rating 4.7 "beer_001"
ZADD lb:beers:rating 4.2 "beer_002"
ZADD lb:beers:rating 3.9 "beer_003"

# Top 10 cervejas por rating
ZREVRANGE lb:beers:rating 0 9 WITHSCORES

# Ranking de revisores
ZADD lb:users:reviews 23 "user_001"
ZADD lb:users:reviews 15 "user_002"
ZREVRANGE lb:users:reviews 0 9 WITHSCORES

# Posição de um elemento
ZREVRANK lb:beers:rating "beer_001"
```

---

### Rate Limiting — Sliding Window (Sorted Set)

```bash
# Simular rate limiting manual (5 pedidos / 15 min por IP)
# Cada pedido:
ZADD rate:login_fail:192.168.1.1 1710000000000 "1710000000000-1"

# Remover entradas mais antigas que a janela (15 min = 900000ms)
ZREMRANGEBYSCORE rate:login_fail:192.168.1.1 0 1709999100000

# Contar pedidos na janela atual
ZCARD rate:login_fail:192.168.1.1

# Limpar após login bem-sucedido
DEL rate:login_fail:192.168.1.1
```

---

### Mensagens Não Lidas (Hash por utilizador)

```bash
# Nova mensagem de user_002 para user_001
HINCRBY unread:user_001 user_002 1

# Ver todos os chats com não lidos
HGETALL unread:user_001

# Número de chats com não lidos (badge)
HLEN unread:user_001

# Utilizador abriu chat com user_002 → limpar
HDEL unread:user_001 user_002
```

---

### Utilizadores Online (Set)

```bash
# Marcar como online (ao fazer login)
SADD online:2026-03-20 user_001
EXPIRE online:2026-03-20 86400

# Verificar se está online
SISMEMBER online:2026-03-20 user_001

# Quantos online hoje
SCARD online:2026-03-20

# Lista de todos online
SMEMBERS online:2026-03-20
```

---

### Pesquisas Recentes (List)

```bash
# Adicionar pesquisa ao histórico (sem duplicados, máx 10)
LREM search:user_001 0 "IPA"
LPUSH search:user_001 "IPA"
LTRIM search:user_001 0 9
EXPIRE search:user_001 3600

# Obter histórico de pesquisas
LRANGE search:user_001 0 9
```

---

### Pub/Sub — Testar Notificações em Tempo Real

```bash
# Terminal 1 — subscrever canal de um utilizador
SUBSCRIBE user:user_001:notifications

# Terminal 2 — publicar notificação
PUBLISH user:user_001:notifications '{"type":"NEW_LIKE","reviewId":"review_001","beerId":"beer_001"}'

# Publicar nova mensagem
PUBLISH user:user_001:messages '{"type":"NEW_MESSAGE","senderId":"user_002","content":"Olá!"}'

# Publicar evento global (novo beer)
PUBLISH beersocial:global '{"type":"NEW_BEER","beerId":"beer_002","beerName":"Porto Stout"}'
```

---

### Comandos Úteis de Diagnóstico

```bash
# Ver todas as chaves (não usar em produção)
KEYS *

# Ver chaves por padrão
KEYS session:*
KEYS cache:*
KEYS counter:*

# Tipo de uma chave
TYPE session:sess_abc123
TYPE lb:beers:rating
TYPE unread:user_001

# Info do servidor
INFO server
INFO memory
INFO stats

# Monitor (ver todos os comandos em tempo real)
MONITOR

# Flush tudo (CUIDADO!)
FLUSHALL
```

---

## 4. Cassandra — Setup e Operações

### Conectar ao Cassandra
```bash
# Via cqlsh no container
docker exec -it beersocial-cassandra cqlsh

# Com keyspace diretamente
docker exec -it beersocial-cassandra cqlsh -k beersocial
```

---

### Criar Keyspace e Tabelas

```cql
-- Criar keyspace
CREATE KEYSPACE IF NOT EXISTS beersocial
WITH REPLICATION = {
    'class': 'SimpleStrategy',
    'replication_factor': 1
};

USE beersocial;

-- ============================================
-- TABELA: user_timeline
-- Feed do utilizador ordenado por data
-- ============================================
CREATE TABLE IF NOT EXISTS user_timeline (
    user_id        UUID,
    created_at     TIMESTAMP,
    review_id      UUID,
    author_id      UUID,
    author_name    TEXT,
    beer_id        UUID,
    beer_name      TEXT,
    beer_style     TEXT,
    rating         DECIMAL,
    content        TEXT,
    likes_count    INT,
    comments_count INT,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND default_time_to_live = 604800;

-- ============================================
-- TABELA: messages
-- Mensagens privadas entre dois utilizadores
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
    conversation_id TEXT,
    created_at      TIMESTAMP,
    message_id      UUID,
    sender_id       TEXT,
    receiver_id     TEXT,
    sender_name     TEXT,
    content         TEXT,
    is_read         BOOLEAN,
    PRIMARY KEY (conversation_id, created_at)
) WITH CLUSTERING ORDER BY (created_at ASC);

CREATE INDEX IF NOT EXISTS idx_messages_sender_id   ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages (receiver_id);

-- ============================================
-- TABELA: notifications
-- Notificações por utilizador
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    user_id         UUID,
    created_at      TIMESTAMP,
    notification_id UUID,
    type            TEXT,
    title           TEXT,
    message         TEXT,
    data            TEXT,
    is_read         BOOLEAN,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND default_time_to_live = 2592000;

-- ============================================
-- TABELA: user_activity
-- Log de atividade do utilizador
-- ============================================
CREATE TABLE IF NOT EXISTS user_activity (
    user_id       UUID,
    created_at    TIMESTAMP,
    activity_id   UUID,
    activity_type TEXT,
    beer_id       UUID,
    beer_name     TEXT,
    rating        DECIMAL,
    content       TEXT,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC);

-- ============================================
-- TABELA: beer_reviews_index
-- Índice invertido de reviews por cerveja
-- ============================================
CREATE TABLE IF NOT EXISTS beer_reviews_index (
    beer_id    UUID,
    created_at TIMESTAMP,
    review_id  UUID,
    user_id    UUID,
    user_name  TEXT,
    rating     DECIMAL,
    content    TEXT,
    PRIMARY KEY (beer_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC);

-- ============================================
-- TABELA: followers
-- Quem segue um utilizador
-- ============================================
CREATE TABLE IF NOT EXISTS followers (
    user_id       UUID,
    follower_id   UUID,
    follower_name TEXT,
    followed_at   TIMESTAMP,
    PRIMARY KEY (user_id, follower_id)
);

-- ============================================
-- TABELA: following
-- A quem um utilizador segue
-- ============================================
CREATE TABLE IF NOT EXISTS following (
    user_id        UUID,
    following_id   UUID,
    following_name TEXT,
    followed_at    TIMESTAMP,
    PRIMARY KEY (user_id, following_id)
);

-- ============================================
-- TABELA: rate_limiting
-- Contadores distribuídos por ação
-- ============================================
CREATE TABLE IF NOT EXISTS rate_limiting (
    user_action   TEXT,
    bucket_start  TIMESTAMP,
    request_count COUNTER,
    PRIMARY KEY (user_action, bucket_start)
);
```

---

### Inserir Dados (Exemplos)

> **Nota:** Cassandra usa UUIDs reais (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). Os IDs do MongoDB não são compatíveis diretamente.

```cql
USE beersocial;

-- Inserir entrada no feed (user_timeline)
INSERT INTO user_timeline (
    user_id, created_at, review_id, author_id, author_name,
    beer_id, beer_name, beer_style, rating, content, likes_count, comments_count
) VALUES (
    11111111-1111-1111-1111-111111111111,
    toTimestamp(now()),
    uuid(),
    22222222-2222-2222-2222-222222222222,
    'Ana Silva',
    33333333-3333-3333-3333-333333333333,
    'Porto Lager', 'Lager', 4.5, 'Ótima cerveja!',
    0, 0
);

-- Enviar mensagem
-- conversation_id = sort([user1, user2]) concatenado com _
INSERT INTO messages (
    conversation_id, created_at, message_id,
    sender_id, receiver_id, sender_name, content, is_read
) VALUES (
    'user_001_user_002',
    toTimestamp(now()),
    uuid(),
    'user_001', 'user_002', 'Ana Silva', 'Olá Bruno!', false
);

-- Criar notificação
INSERT INTO notifications (
    user_id, created_at, notification_id,
    type, title, message, data, is_read
) VALUES (
    22222222-2222-2222-2222-222222222222,
    toTimestamp(now()),
    uuid(),
    'NEW_LIKE', 'Novo Like',
    'Ana Silva gostou da tua review',
    '{"reviewId":"review_001","beerId":"beer_001"}',
    false
);

-- Registar atividade
INSERT INTO user_activity (
    user_id, created_at, activity_id,
    activity_type, beer_id, beer_name, rating, content
) VALUES (
    22222222-2222-2222-2222-222222222222,
    toTimestamp(now()),
    uuid(),
    'REVIEW',
    33333333-3333-3333-3333-333333333333,
    'Porto Lager', 4.5, 'Ótima cerveja!'
);

-- Seguir utilizador (dual-write em batch)
BEGIN BATCH
    INSERT INTO followers  (user_id, follower_id, follower_name, followed_at)
    VALUES (
        22222222-2222-2222-2222-222222222222,
        11111111-1111-1111-1111-111111111111,
        'Ana Silva', toTimestamp(now())
    );
    INSERT INTO following  (user_id, following_id, following_name, followed_at)
    VALUES (
        11111111-1111-1111-1111-111111111111,
        22222222-2222-2222-2222-222222222222,
        'Bruno Costa', toTimestamp(now())
    );
APPLY BATCH;
```

---

### Queries de Leitura

```cql
USE beersocial;

-- Feed de um utilizador (SEMPRE filtra pela partition key)
SELECT * FROM user_timeline
WHERE user_id = 11111111-1111-1111-1111-111111111111
LIMIT 20;

-- Conversa entre dois utilizadores
SELECT * FROM messages
WHERE conversation_id = 'user_001_user_002'
LIMIT 50;

-- Notificações de um utilizador
SELECT * FROM notifications
WHERE user_id = 22222222-2222-2222-2222-222222222222
LIMIT 20;

-- Atividade recente de um utilizador
SELECT * FROM user_activity
WHERE user_id = 22222222-2222-2222-2222-222222222222
LIMIT 50;

-- Reviews de uma cerveja
SELECT * FROM beer_reviews_index
WHERE beer_id = 33333333-3333-3333-3333-333333333333
LIMIT 20;

-- Seguidores de um utilizador
SELECT * FROM followers
WHERE user_id = 22222222-2222-2222-2222-222222222222;

-- A quem um utilizador segue
SELECT * FROM following
WHERE user_id = 11111111-1111-1111-1111-111111111111;
```

---

### Operações de Update

```cql
USE beersocial;

-- Marcar mensagem como lida (requer partition key + clustering key)
UPDATE messages SET is_read = true
WHERE conversation_id = 'user_001_user_002'
  AND created_at = '2026-03-20 10:00:00+0000';

-- Marcar notificação como lida
UPDATE notifications SET is_read = true
WHERE user_id = 22222222-2222-2222-2222-222222222222
  AND created_at = '2026-03-20 10:00:00+0000';

-- Incrementar rate limit counter
UPDATE rate_limiting
SET request_count = request_count + 1
WHERE user_action = 'user_001:review'
  AND bucket_start = '2026-03-20 10:00:00+0000';

-- Consultar rate limit
SELECT request_count FROM rate_limiting
WHERE user_action = 'user_001:review'
  AND bucket_start = '2026-03-20 10:00:00+0000';
```

---

### Comandos Úteis de Diagnóstico

```cql
-- Ver todos os keyspaces
DESCRIBE KEYSPACES;

-- Ver todas as tabelas
USE beersocial;
DESCRIBE TABLES;

-- Ver schema de uma tabela
DESCRIBE TABLE user_timeline;
DESCRIBE TABLE messages;

-- Ver estatísticas de uma tabela
SELECT * FROM system_schema.tables WHERE keyspace_name = 'beersocial';

-- Ver colunas de uma tabela
SELECT column_name, type FROM system_schema.columns
WHERE keyspace_name = 'beersocial' AND table_name = 'messages';

-- Ver indexes
SELECT * FROM system_schema.indexes WHERE keyspace_name = 'beersocial';

-- Apagar tabela (CUIDADO!)
DROP TABLE IF EXISTS user_timeline;

-- Apagar keyspace (CUIDADO!)
DROP KEYSPACE IF EXISTS beersocial;
```

---

## 5. Seeds — Popular com Dados de Teste

### Executar seed de utilizadores
```bash
# Na raiz do projeto
npx tsx scripts/seed-users.ts
```

### Seed manual via API (após arrancar a app)

```bash
# Registar utilizadores de teste
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana Silva","username":"ana","email":"ana@test.pt","password":"password123"}'

curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Bruno Costa","username":"bruno","email":"bruno@test.pt","password":"password123"}'
```

---

## 6. API HTTP — Testar Sem Frontend

> Arrancar a aplicação: `npm run dev` (porta 3000)

### Autenticação

```bash
# Registar
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana Silva","username":"ana","email":"ana@test.pt","password":"password123"}'

# Login (guarda cookie de sessão)
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@test.pt","password":"password123"}'

# Ver utilizador atual
curl -b cookies.txt http://localhost:3000/api/auth/me

# Logout
curl -b cookies.txt -X POST http://localhost:3000/api/auth/logout
```

---

### Cervejas

```bash
# Listar cervejas
curl -b cookies.txt http://localhost:3000/api/beers

# Pesquisar cervejas
curl -b cookies.txt "http://localhost:3000/api/beers?search=lager"

# Filtrar por estilo
curl -b cookies.txt "http://localhost:3000/api/beers?style=IPA"

# Criar cerveja
curl -b cookies.txt -X POST http://localhost:3000/api/beers \
  -H "Content-Type: application/json" \
  -d '{"name":"Porto Lager","brewery":"Cervejaria Invicta","style":"Lager","abv":5.2,"ibu":18,"description":"Suave e refrescante","country":"Portugal"}'

# Ver cerveja específica
curl -b cookies.txt http://localhost:3000/api/beers/beer_001
```

---

### Reviews

```bash
# Reviews de uma cerveja
curl -b cookies.txt "http://localhost:3000/api/reviews?beerId=beer_001"

# Reviews de um utilizador
curl -b cookies.txt "http://localhost:3000/api/reviews?userId=user_001"

# Criar review
curl -b cookies.txt -X POST http://localhost:3000/api/reviews \
  -H "Content-Type: application/json" \
  -d '{"beerId":"beer_001","beerName":"Porto Lager","rating":4.5,"content":"Excelente cerveja!"}'
```

---

### Likes e Comentários

```bash
# Dar like
curl -b cookies.txt -X POST http://localhost:3000/api/likes \
  -H "Content-Type: application/json" \
  -d '{"reviewId":"review_001","action":"like"}'

# Remover like
curl -b cookies.txt -X POST http://localhost:3000/api/likes \
  -H "Content-Type: application/json" \
  -d '{"reviewId":"review_001","action":"unlike"}'

# Comentar
curl -b cookies.txt -X POST http://localhost:3000/api/comments \
  -H "Content-Type: application/json" \
  -d '{"reviewId":"review_001","content":"Concordo totalmente!"}'
```

---

### Amigos

```bash
# Ver amigos e pedidos pendentes
curl -b cookies.txt http://localhost:3000/api/friends

# Enviar pedido de amizade
curl -b cookies.txt -X POST http://localhost:3000/api/friends \
  -H "Content-Type: application/json" \
  -d '{"addresseeId":"user_002"}'

# Aceitar pedido
curl -b cookies.txt -X PUT http://localhost:3000/api/friends \
  -H "Content-Type: application/json" \
  -d '{"friendshipId":"friend_001","action":"accept"}'

# Rejeitar pedido
curl -b cookies.txt -X PUT http://localhost:3000/api/friends \
  -H "Content-Type: application/json" \
  -d '{"friendshipId":"friend_001","action":"reject"}'
```

---

### Mensagens

```bash
# Listar conversas
curl -b cookies.txt http://localhost:3000/api/messages

# Ver conversa com utilizador específico
curl -b cookies.txt "http://localhost:3000/api/messages?userId=user_002"

# Enviar mensagem
curl -b cookies.txt -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{"receiverId":"user_002","receiverName":"Bruno Costa","content":"Olá Bruno!"}'
```

---

### Notificações

```bash
# Ver notificações
curl -b cookies.txt http://localhost:3000/api/notifications

# Marcar todas como lidas
curl -b cookies.txt -X PUT http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -d '{"markAllRead":true}'
```

---

### Redis — Endpoints de Demonstração

```bash
# Estatísticas de contadores e leaderboards
curl http://localhost:3000/api/redis/counters

# Trending beers
curl http://localhost:3000/api/redis/counters?action=trending

# Leaderboard
curl http://localhost:3000/api/redis/counters?action=leaderboard

# Testar rate limiting
curl -X POST http://localhost:3000/api/redis/counters \
  -H "Content-Type: application/json" \
  -d '{"action":"rateLimit","key":"test:api","maxRequests":5,"windowSeconds":60}'

# Incrementar contador
curl -X POST http://localhost:3000/api/redis/counters \
  -H "Content-Type: application/json" \
  -d '{"action":"increment","key":"demo:views"}'
```

---

### SSE — Testar Notificações em Tempo Real

```bash
# Subscrever SSE (mantém ligação aberta)
curl -b cookies.txt -N http://localhost:3000/api/realtime

# Em paralelo — publicar evento via Redis para ver em tempo real:
docker exec -it beersocial-redis redis-cli \
  PUBLISH beersocial:global '{"type":"NEW_BEER","beerId":"beer_999","beerName":"Test Beer"}'
```

---

## 7. Verificação de Estado

### Estado geral da app
```bash
curl http://localhost:3000/api/status
```

### Verificar ligações às BDs (via app)
```bash
curl http://localhost:3000/api/route
```

### Estado dos containers Docker
```bash
docker-compose ps
docker stats --no-stream
```

### Verificar dados nas BDs

```bash
# MongoDB — contar documentos por coleção
docker exec -it beersocial-mongodb mongosh \
  -u beersocial -p beersocial123 \
  --authenticationDatabase admin beersocial \
  --eval "['users','beers','reviews','friendships','notifications','conversations'].forEach(c => print(c + ': ' + db[c].countDocuments()))"

# Redis — número de chaves por tipo
docker exec -it beersocial-redis redis-cli INFO keyspace

# Cassandra — contar linhas nas tabelas principais
docker exec -it beersocial-cassandra cqlsh -k beersocial -e "
  SELECT COUNT(*) FROM user_timeline;
  SELECT COUNT(*) FROM messages;
  SELECT COUNT(*) FROM notifications;
"
```
