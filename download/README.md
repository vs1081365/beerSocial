# BeerSocial - Arquitetura Poliglota

Aplicação social para cervejas com arquitetura de **3 bases de dados especializadas** (sem SQLite/Prisma).

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                     BeerSocial Application                       │
│                     (Next.js 16 + TypeScript)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│     Redis     │    │    MongoDB    │    │   Cassandra   │
│  Cache/Speed  │    │  Documents    │    │  Distributed  │
└───────────────┘    └───────────────┘    └───────────────┘
```

## 📊 Tecnologias por Propósito

### 🔴 REDIS - Cache e Baixa Latência

**Porquê Redis?**
- Latência sub-milissegundo
- TTL automático para expiração
- Operações atómicas (INCR, DECR)
- Estruturas ricas (Hash, Set, ZSet)
- Pub/Sub para tempo real

**Uso no BeerSocial:**
| Funcionalidade | Estrutura | Comando |
|---------------|-----------|---------|
| Cache de queries | String com TTL | `SETEX key 60 value` |
| Sessões de user | Hash | `HSET session:id userId name email` |
| Contador de likes | String | `INCR beer:123:likes` |
| Views do dia | Hash | `HINCRBY views:2024-01 beerId 1` |
| Leaderboards | Sorted Set | `ZADD lb:beers 4.5 beerId` |
| Rate Limiting | Sorted Set + Lua | Sliding window |
| Utilizadores online | Set | `SADD online:today userId` |
| Pub/Sub notificações | Pub/Sub | `PUBLISH user:123:notifications msg` |

**Endpoints:** `/api/redis/cache`, `/api/redis/session`, `/api/redis/counters`

---

### 🟢 MONGODB - Dados Documentais

**Porquê MongoDB?**
- Documentos embedded (sem JOINs!)
- Schema flexível
- Arrays e objetos aninhados
- Agregações poderosas
- TTL indexes para auto-expiração

**Collections:**
| Collection | Propósito | Schema |
|------------|-----------|--------|
| `users` | Contas de utilizador | `{ email, password, name, username, avatar, bio }` |
| `beers` | Catálogo de cervejas | `{ name, brewery, style, abv, ibu, description }` |
| `reviews` | Reviews com comments embedded | `{ userId, beerId, rating, comments: [], likes: [] }` |
| `friendships` | Amizades entre users | `{ requesterId, addresseeId, status }` |
| `notifications` | Notificações | `{ userId, type, title, message, isRead }` |

**Vantagens:**
- `comments[]` EMBEDDED no documento de review - uma query obtém tudo
- `likes[]` como array de userIds - verificar like em O(1)
- TTL index para logs - auto-expiração

**Endpoints:** `/api/beers`, `/api/reviews`, `/api/users`, `/api/friends`, `/api/mongo/reviews`

---

### 🟡 CASSANDRA - Dados Distribuídos

**Porquê Cassandra?**
- Modelação query-first (tabela desenhada PARA a query)
- Partition key para distribuição automática
- Clustering key para ordenação
- Escalabilidade linear de escrita
- TTL nativo

**Tabelas:**
| Tabela | Partition Key | Clustering Key | Query |
|--------|--------------|----------------|-------|
| `user_timeline` | `user_id` | `created_at DESC` | Feed de um user ordenado |
| `messages` | `conversation_id` | `created_at ASC` | Conversa ordenada |
| `notifications` | `user_id` | `created_at DESC` | Notificações de um user |
| `beer_reviews_index` | `beer_id` | `created_at DESC` | Reviews de uma cerveja |
| `followers` | `user_id` | `follower_id` | Seguidores de um user |
| `following` | `user_id` | `following_id` | Following de um user |
| `rate_limiting` | `user_action` | `bucket_start` | Rate limit counter |

**Design de Partition Key:**
```sql
-- Timeline: cada user tem sua partição
SELECT * FROM user_timeline WHERE user_id = ? LIMIT 20;
-- Query O(limit), não O(total)

-- Messages: conversation_id = hash ordenado(user1 + user2)
SELECT * FROM messages WHERE conversation_id = ?;
-- Todas as mensagens de uma conversa na mesma partição
```

**Endpoints:** `/api/cassandra/timeline`, `/api/cassandra/messages`

---

## 🚀 Iniciar com Docker

```bash
# Iniciar containers
docker-compose up -d

# Verificar status das ligações
curl http://localhost:3000/api/status
```

**Containers:**
| Serviço | Porta | Propósito |
|---------|-------|-----------|
| Redis | 6379 | Cache, sessões, contadores |
| MongoDB | 27017 | Documentos (users, beers, reviews) |
| Cassandra | 9042 | Timeline, mensagens, followers |

---

## 📡 Endpoints por Tecnologia

### Status Geral
```
GET /api/status
```
Verifica ligação a todas as BDs e mostra arquitetura.

---

### Redis Endpoints

#### Cache
```
GET  /api/redis/cache                    # Info sobre estruturas
GET  /api/redis/cache?key=beers:all      # Obter valor
POST /api/redis/cache { key, value, ttl } # Definir valor
DELETE /api/redis/cache?key=beers:all    # Apagar
GET  /api/redis/cache?pattern=beers:*    # Invalidar padrão
```

#### Sessões
```
GET  /api/redis/session          # Ver sessão atual
POST /api/redis/session { userId, email, name } # Criar sessão demo
```

#### Contadores
```
GET /api/redis/counters                     # Info
GET /api/redis/counters?action=trending     # Cervejas trending (views hoje)
GET /api/redis/counters?action=leaderboard  # Top cervejas/reviewers
POST /api/redis/counters { action: "increment", key: "beer:123:likes" }
POST /api/redis/counters { action: "rateLimit", key: "user:api" }
```

---

### MongoDB Endpoints

#### Beers
```
GET  /api/beers                # Listar cervejas
POST /api/beers                # Criar cerveja
GET  /api/beers/[id]           # Detalhes de cerveja
```

#### Reviews
```
GET  /api/reviews              # Feed de reviews
POST /api/reviews              # Criar review
```

#### Users
```
GET  /api/users                # Pesquisar users
GET  /api/users/[id]           # Perfil de user
PUT  /api/users/[id]           # Atualizar perfil
```

#### Friends
```
GET   /api/friends             # Amigos e pedidos
POST  /api/friends             # Enviar pedido
PUT   /api/friends             # Aceitar/Rejeitar
```

#### Mongo Reviews (explicativo)
```
GET/POST/PUT /api/mongo/reviews # Reviews com embedded comments
```

---

### Cassandra Endpoints

#### Timeline
```
GET  /api/cassandra/timeline          # Feed do user
POST /api/cassandra/timeline          # Adicionar ao feed dos followers
```

#### Messages
```
GET  /api/cassandra/messages?userId=xxx  # Conversa
POST /api/cassandra/messages             # Enviar mensagem
```

---

## 🔧 Variáveis de Ambiente

```env
# Redis
REDIS_URL=redis://localhost:6379

# MongoDB
MONGODB_URL=mongodb://beersocial:beersocial123@localhost:27017
MONGODB_DB=beersocial

# Cassandra
CASSANDRA_CONTACT_POINTS=localhost
CASSANDRA_DC=datacenter1
CASSANDRA_KEYSPACE=beersocial
```

---

## 📁 Estrutura de Ficheiros

```
src/lib/
├── redis-client.ts      # Redis: cache, sessões, contadores, pub/sub
├── mongodb-client.ts    # MongoDB: documentos, agregações
├── cassandra-client.ts  # Cassandra: partition key queries
└── auth.ts              # Auth usando Redis (sessões) + MongoDB (users)

src/app/api/
├── status/              # Status de todas as BDs
├── auth/                # Login/Register (MongoDB users + Redis sessions)
├── redis/
│   ├── cache/           # Cache endpoints
│   ├── session/         # Sessão endpoints
│   └── counters/        # Contadores endpoints
├── mongo/
│   └── reviews/         # Reviews com embedded comments
├── cassandra/
│   ├── timeline/        # Feed com partition key
│   └── messages/        # Chat com conversation_id
├── beers/               # CRUD de cervejas
├── reviews/             # CRUD de reviews
├── users/               # CRUD de users
├── friends/             # Sistema de amizade
├── likes/               # Sistema de likes
├── comments/            # Sistema de comments
├── messages/            # Sistema de mensagens
└── notifications/       # Sistema de notificações

docker/
├── mongo-init.js        # Init MongoDB (indexes, validação)
└── cassandra-init.cql   # Init Cassandra (keyspace, tables)

docker-compose.yml       # Containers Redis, MongoDB, Cassandra
```

---

## 📊 Comparação de Uso

| Funcionalidade | Tecnologia | Razão |
|---------------|------------|-------|
| Sessões | Redis | TTL automático, latência <1ms |
| Cache de queries | Redis | Invalidação por padrão, TTL |
| Contador de likes | Redis | INCR atómico |
| Utilizadores online | Redis | Set com TTL diário |
| Rate Limiting | Redis | Sorted set + Lua (sliding window) |
| Pub/Sub tempo real | Redis | Native pub/sub |
| Users, Beers | MongoDB | Documentos com schema flexível |
| Reviews | MongoDB | Comments embedded (sem JOIN) |
| Friendships | MongoDB | Relações entre users |
| Timeline/Feed | Cassandra | Partition por user_id |
| Mensagens | Cassandra | Partition por conversation_id |
| Followers | Cassandra | Partition por user_id |

---

## 🚀 Download

Projeto disponível em: `/home/z/my-project/download/beersocial-app.zip`
