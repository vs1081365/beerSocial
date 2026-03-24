# BeerSocial — Database Architecture & Operations

A social network for beer lovers built with **Next.js**, powered by three complementary databases — each chosen for its specific strengths.

---

## Why Three Databases?

| Database | Role | Strengths Used |
|----------|------|----------------|
| **MongoDB** | Primary data store | Flexible documents, embedded arrays (comments/likes inside reviews), rich queries, aggregation |
| **Redis** | Speed layer | In-memory cache (sub-ms reads), sessions, atomic counters, pub/sub for real-time, sorted sets for leaderboards |
| **Cassandra** | Scale layer | Linear write scalability, partition-based feeds/timelines, TTL expiration, distributed counters |

---

## Como Executar o Projeto

### 1) Preparar ambiente

Pre-requisitos:

- Node.js 20+
- npm 10+
- Docker Desktop (com Docker Compose)
- Bun (opcional, so necessario para alguns scripts, por exemplo db:seed e start em producao)

Instalacao de dependencias:

1. Na raiz do projeto, instalar dependencias:
  npm install

Configuracao de ambiente:

1. Garantir que existe um ficheiro env.local na raiz.
2. Usar estes valores (nomes alinhados com o codigo):

  MONGODB_URL=mongodb://beersocial:beersocial123@localhost:27017/beersocial?authSource=admin
  MONGODB_DB=beersocial
  REDIS_URL=redis://localhost:6379
  CASSANDRA_CONTACT_POINTS=localhost
  CASSANDRA_DC=datacenter1
  CASSANDRA_KEYSPACE=beersocial
  NEXT_PUBLIC_APP_URL=http://localhost:3000
  NODE_ENV=development

Notas:

- Se MONGODB_URL nao estiver definido, o cliente MongoDB usa o valor default interno.
- Se CASSANDRA_DC nao estiver definido, o cliente Cassandra usa datacenter1.

### 2) Iniciar servicos (Docker)

1. Arrancar MongoDB, Redis e Cassandra:
  docker compose up -d

2. Confirmar containers:
  docker compose ps

3. Ver logs (opcional):
  docker compose logs -f

4. Iniciar aplicacao:
  npm run dev

5. Abrir no browser:
  http://localhost:3000

Parar servicos:

- docker compose down

Reset completo de dados (apaga volumes):

- docker compose down -v

### 3) Executar fluxos obrigatorios

Executar os fluxos abaixo para validar a arquitetura poliglota em funcionamento.

Fluxo A - Autenticacao e sessao (MongoDB + Redis):

1. Registar utilizador em POST /api/auth/register.
2. Fazer login em POST /api/auth/login.
3. Confirmar utilizador autenticado em GET /api/auth/me.

Resultado esperado:

- Utilizador persistido no MongoDB.
- Sessao criada no Redis com TTL.

Fluxo B - Catalogo e reviews (MongoDB + Redis + Cassandra):

1. Criar cerveja em POST /api/beers.
2. Criar review em POST /api/reviews.
3. Ler feed em GET /api/reviews e detalhe em GET /api/beers/[id].

Resultado esperado:

- Cerveja e review guardadas no MongoDB (source of truth).
- Cache Redis invalida/atualiza conforme writes e reads.
- Cassandra recebe dados derivados (timeline/activity/index) em best effort.

Fluxo C - Interacao social (likes, comentarios, amigos):

1. Comentar review em POST /api/comments.
2. Dar like em POST /api/likes.
3. Enviar e aceitar pedido de amizade em POST/PUT /api/friends.

Resultado esperado:

- Comentarios e likes embedded no documento review (MongoDB).
- Notificacoes persistidas no MongoDB.
- Publicacao de eventos real-time via Redis Pub/Sub.
- Relacoes followers/following sincronizadas no Cassandra apos amizade aceite.

Fluxo D - Mensagens e tempo real (Cassandra + Redis + SSE):

1. Enviar mensagem em POST /api/messages.
2. Abrir stream SSE em GET /api/realtime (user autenticado).
3. Confirmar entrega em tempo real de eventos notification/message/global.

Resultado esperado:

- Mensagens armazenadas por conversation_id no Cassandra.
- Metadata de conversas no MongoDB.
- Eventos em tempo real via Redis Pub/Sub e SSE.

### 4) Correr testes e metricas usados no projeto

Testes/qualidade disponiveis neste repositorio:

1. Lint (qualidade esttica):
  npm run lint

2. Build de producao (integridade de compilacao):
  npm run build

3. Health check da arquitetura (metrica operacional):
  GET /api/status

Validacao recomendada do endpoint /api/status:

- success deve ser true.
- databases.redis.connected = true
- databases.mongodb.connected = true
- databases.cassandra.connected = true

Opcional:

1. Seed de utilizadores para testes manuais:
  npm run db:seed

2. Teste manual de notificacoes de review:
  POST /api/status

3. Seed completo (dados de teste para MongoDB + Redis + Cassandra):
  npm run db:seed:full

4. Limpeza de reviews MongoDB:
  npm run db:clear:reviews

5. Limpeza de reviews/timeline no Cassandra:
  npm run db:clear:cassandra-reviews

6. Deduplicacao de cervejas e reconciliacao de artefactos:
  npm run db:dedupe:beers

7. Carga basica de API (latencia, throughput, taxa de sucesso):
  npm run load:test

Variaveis opcionais para scripts novos:

- Seed: SEED_USERS, SEED_BEERS, SEED_REVIEWS, SEED_MESSAGES
- Load test: LOAD_BASE_URL, LOAD_REQUESTS, LOAD_CONCURRENCY, LOAD_TIMEOUT_MS

---

## MongoDB — Source of Truth

> **Client**: `src/lib/mongodb-client.ts`  
> **Connection**: `mongodb://beersocial:beersocial123@localhost:27017/beersocial?authSource=admin`

### Users Collection

| Method | Route | Purpose |
|--------|-------|---------|
| `createUser()` | `POST /api/auth/register` | Register a new user account |
| `getUserByEmail()` | `POST /api/auth/login` | Authenticate user by email |
| `getUserByUsername()` | `POST /api/auth/register` | Check username uniqueness |
| `getUserById()` | `/api/friends`, `/api/messages`, `/api/comments` | Fetch full user profile (avatar, username) |
| `searchUsers()` | `GET /api/users` | Regex search on name/username for friend discovery |
| `getAllUsers()` | `GET /api/users`, `POST /api/status` | List all users |
| `updateUser()` | User profile updates | Update bio, avatar, location, favourite beer |

**Why MongoDB?** Users have varied profile fields (bio, location, avatar, favoriteBeer). Schema flexibility lets us add fields without migrations. Unique indexes on `email` and `username` enforce constraints.

---

### Beers Collection

| Method | Route | Purpose |
|--------|-------|---------|
| `createBeer()` | `POST /api/beers` | Add a new beer to the catalogue |
| `getBeerById()` | `GET /api/beers/[id]`, `/api/reviews`, `/api/comments` | Fetch beer details (name, brewery, image) |
| `getBeers(filter, limit, offset)` | `GET /api/beers` | Search/filter beers with pagination |
| `countBeers()` | `GET /api/beers` | Total count for pagination |
| `getBeerReviewStats()` | `GET /api/beers`, `GET /api/beers/[id]` | Aggregate avg rating and review count |

**Why MongoDB?** Beer documents have varying optional fields (ibu, description, country, image). Aggregation pipeline computes `avgRating` and `totalReviews` across reviews. Text indexes on `name`, `brewery`, `style` power search.

---

### Reviews Collection (Embedded Comments & Likes)

| Method | Route | Purpose |
|--------|-------|---------|
| `createReview()` | `POST /api/reviews` | Create a beer review |
| `getReviewById()` | `/api/comments`, `/api/likes`, `/api/beers/[id]` | Load single review with all embedded data |
| `getReviewsByBeer()` | `GET /api/reviews?beerId=` | All reviews for a specific beer |
| `getReviewsByUser()` | `GET /api/reviews?userId=` | A user's review history |
| `getAllReviews()` | `GET /api/reviews` | Global feed |
| `checkUserReviewed()` | `POST /api/reviews` | Prevent duplicate reviews per beer |
| `addComment()` | `POST /api/comments` | `$push` a comment into embedded `comments[]` |
| `addLike()` / `removeLike()` | `POST /api/likes` | `$push` / `$pull` userId in embedded `likes[]` |

**Why MongoDB?** Comments and likes are **embedded inside the review document**. A single read returns the review + all comments + all likes — zero JOINs. The `$push` / `$pull` atomic operators modify arrays in-place without overwriting the document.

**Document structure:**
```json
{
  "_id": "review_123",
  "userId": "user_456",
  "beerId": "beer_789",
  "rating": 4.5,
  "content": "Great IPA!",
  "comments": [
    { "userId": "user_111", "userName": "Alice", "content": "Agree!", "createdAt": "..." }
  ],
  "likes": ["user_222", "user_333"]
}
```

---

### Friendships Collection

| Method | Route | Purpose |
|--------|-------|---------|
| `createFriendship()` | `POST /api/friends` | Send a friend request (`status: PENDING`) |
| `getFriendshipBetween()` | `POST /api/friends` | Check if friendship exists (prevent duplicates) |
| `getFriends()` | `GET /api/friends` | List accepted friends (both directions) |
| `getPendingRequests()` | `GET /api/friends` | Incoming requests awaiting response |
| `getSentRequests()` | `GET /api/friends` | Outgoing requests the user has sent |
| `updateFriendshipStatus()` | `PUT /api/friends` | Accept or reject a request |

**Why MongoDB?** Bidirectional queries (`requesterId` or `addresseeId`) with compound indexes. Status field enables filtering `PENDING` / `ACCEPTED` / `REJECTED`.

---

### Notifications Collection

| Method | Route | Purpose |
|--------|-------|---------|
| `createNotification()` | `/api/likes`, `/api/comments`, `/api/reviews`, `/api/friends` | Create notification for user |
| `getNotifications()` | `GET /api/notifications` | List user's notifications (newest first) |
| `countUnreadNotifications()` | `GET /api/notifications` | Badge count for header |
| `markNotificationRead()` | `PUT /api/notifications` | Mark single notification as read |
| `markAllNotificationsRead()` | `PUT /api/notifications` | Mark all as read |

**Notification types:** `BEER_REVIEW`, `NEW_LIKE`, `NEW_COMMENT`, `FRIEND_REQUEST`, `FRIEND_ACCEPTED`, `NEW_MESSAGE`

**Why MongoDB?** Each notification stores arbitrary `data` (JSON string with reviewId, beerName, etc.). Indexed on `userId + createdAt` for fast retrieval and `userId + isRead` for unread count.

---

### Conversations Collection

| Method | Route | Purpose |
|--------|-------|---------|
| `createConversation()` | `POST /api/messages` | Create conversation on first message between two users |
| `getUserConversations()` | `GET /api/messages` | List all conversations for a user |
| `getConversationById()` | `GET /api/messages` | Load conversation metadata |
| `updateConversationLastMessage()` | `POST /api/messages` | Update preview text and timestamp |

**Why MongoDB?** Conversation metadata (participants, last message preview) is read frequently from the messages sidebar. MongoDB serves this lightweight lookup; actual message bodies live in Cassandra.

---

## Redis — Speed & Real-Time

> **Client**: `src/lib/redis-client.ts`  
> **Connection**: `redis://localhost:6379`

### Sessions (Hash + TTL)

| Method | Route | Redis Command | Key |
|--------|-------|---------------|-----|
| `createSession()` | `POST /api/auth/login` | `HSET` + `EXPIRE 86400` | `session:{sessionId}` |
| `getSession()` | Auth middleware (`getCurrentUser`) | `HGETALL` | `session:{sessionId}` |
| `deleteSession()` | `POST /api/auth/logout` | `DEL` | `session:{sessionId}` |

**Why Redis?** Sessions need sub-millisecond reads on every authenticated request. Hash fields store `userId`, `email`, `name`, `createdAt`, `lastAccess`. TTL auto-expires sessions after 24 hours.

---

### Cache (Strings + TTL)

| What | Key Pattern | TTL | Set In | Read In |
|------|-------------|-----|--------|---------|
| Beer list | `cache:beers:list:{search}:{style}:{limit}:{offset}` | 60s | `GET /api/beers` | `GET /api/beers` |
| Review feed | `cache:reviews:{beerId\|userId\|all}:{limit}:{offset}` | 30s | `GET /api/reviews` | `GET /api/reviews` |
| Comments | `cache:comments:{reviewId}` | 60s | `GET /api/comments` | `GET /api/comments` |
| Notification count | `cache:notifications:{userId}:count` | 10s | `GET /api/notifications` | `GET /api/notifications` |

**Invalidation:** `deleteCache(key)` or `invalidatePattern('beers:list:*')` is called on every POST/PUT that modifies the underlying data.

**Why Redis?** Avoids hitting MongoDB on every page load. Short TTLs keep data fresh; explicit invalidation ensures consistency after writes.

---

### Counters (INCR / DECR)

| Method | Route | Redis Command | Key |
|--------|-------|---------------|-----|
| `likeBeer()` | `POST /api/likes` | `INCR` | `counter:beer:{beerId}:likes` |
| `unlikeBeer()` | `POST /api/likes` | `DECR` | `counter:beer:{beerId}:likes` |

**Why Redis?** Atomic `INCR`/`DECR` handles concurrent likes without race conditions. No need to count the `likes[]` array length on every read.

---

### Leaderboards (Sorted Sets)

| Method | Route | Redis Command | Key |
|--------|-------|---------------|-----|
| `updateBeerRating()` | `GET /api/beers`, `POST /api/likes` | `ZADD` | `lb:beers:rating` |
| `getTopRatedBeers()` | `GET /api/redis/counters?action=leaderboard` | `ZREVRANGE` | `lb:beers:rating` |
| `updateUserReviewCount()` | `POST /api/reviews` | `ZADD` | `lb:users:reviews` |
| `getTopReviewers()` | `GET /api/redis/counters?action=leaderboard` | `ZREVRANGE` | `lb:users:reviews` |

**Why Redis?** Sorted sets maintain ordering by score (rating / review count). `ZREVRANGE` returns top-N in O(log N) — perfect for "Top Rated Beers" and "Top Reviewers" without aggregating from MongoDB.

---

### Online Users (Set)

| Method | Route | Redis Command | Key |
|--------|-------|---------------|-----|
| `setUserOnline()` | `POST /api/auth/login` | `SADD` + `EXPIRE 86400` | `online:YYYY-MM-DD` |
| `isUserOnline()` | Status checks | `SISMEMBER` | `online:YYYY-MM-DD` |
| `getOnlineUsersCount()` | Dashboard | `SCARD` | `online:YYYY-MM-DD` |

**Why Redis?** Sets provide O(1) membership checks and atomic add/remove. Daily key with TTL auto-cleans.

---

### Recent Searches (List)

| Method | Route | Redis Command | Key |
|--------|-------|---------------|-----|
| `addRecentSearch()` | `GET /api/beers` (when `search` param present) | `LREM` + `LPUSH` + `LTRIM 10` | `search:{userId}` |
| `getRecentSearches()` | User profile | `LRANGE 0 9` | `search:{userId}` |

**Why Redis?** Lists with `LPUSH` + `LTRIM` efficiently maintain a capped history. `LREM` before `LPUSH` prevents duplicates. 1-hour TTL auto-expires old search history.

---

### Comment Likes (Set)

| Method | Route | Redis Command | Key |
|--------|-------|---------------|-----|
| `likeComment()` | `POST /api/likes` (with `commentId`) | `SADD` | `comment_likes:{commentId}` |
| `unlikeComment()` | `POST /api/likes` (with `commentId`) | `SREM` | `comment_likes:{commentId}` |
| `isCommentLikedByUser()` | `GET /api/likes` (with `commentId`) | `SISMEMBER` | `comment_likes:{commentId}` |

**Why Redis?** Comment likes are lightweight toggles. Sets provide O(1) `SISMEMBER` to check if a user already liked a comment, and `SADD`/`SREM` for atomic toggle.

---

### Pub/Sub — Real-Time via SSE

| Channel | Publisher | Payload | Subscriber |
|---------|-----------|---------|------------|
| `user:{userId}:notifications` | `/api/likes`, `/api/friends`, `/api/reviews`, `/api/comments` | `{ type, reviewId, timestamp, ... }` | `/api/realtime` → SSE `notification` event |
| `user:{userId}:messages` | `/api/messages POST` | `{ type: 'NEW_MESSAGE', senderId, content, timestamp }` | `/api/realtime` → SSE `message` event |
| `beersocial:global` | `/api/beers POST` | `{ type: 'NEW_BEER', beerId, beerName, brewery }` | `/api/realtime` → SSE `global` event |

**How it works:**
1. API route writes to MongoDB → publishes event to Redis channel
2. `/api/realtime` SSE endpoint has a dedicated Redis subscriber per user
3. On receiving a message, SSE streams it to the browser as a typed event
4. `Header.tsx` listens on `EventSource('/api/realtime')` and dispatches window events
5. `page.tsx` listens for `beersocial:refreshFeed` to reload reviews/beers

**Why Redis Pub/Sub?** Fire-and-forget messaging with zero persistence overhead. If a user is offline, the event is simply dropped — notifications are already persisted in MongoDB. Pub/Sub eliminates client-side polling entirely.

---

## Cassandra — Distributed Writes & Time-Series

> **Client**: `src/lib/cassandra-client.ts`  
> **Connection**: `localhost:9042`, Keyspace: `beersocial`, Data center: `datacenter1`

### user_timeline Table

| Column | Type | Role |
|--------|------|------|
| `user_id` | UUID | **Partition Key** — each user's feed is a separate partition |
| `created_at` | TIMESTAMP | **Clustering Key DESC** — newest reviews first |
| `review_id` | UUID | The review |
| `author_id`, `author_name` | UUID, TEXT | Who wrote the review |
| `beer_id`, `beer_name`, `beer_style` | UUID, TEXT, TEXT | Which beer |
| `rating` | FLOAT | Score |
| `content` | TEXT | Review body |
| `likes_count`, `comments_count` | COUNTER | Denormalized counts |

| Method | Route | Purpose |
|--------|-------|---------|
| `addToTimeline(followerIds, review)` | `POST /api/reviews` | Fan-out: batch insert review into every follower's timeline |
| `getTimeline(userId, limit)` | `GET /api/cassandra/timeline` | Read a user's personalized feed (single partition scan) |
| `incrementTimelineLikes(reviewId, userId, createdAt)` | `POST /api/likes` | Increment `likes_count` counter column |

**Why Cassandra?** Fan-out-on-write: when User A posts a review, it's written to every follower's partition. Reading the feed is a **single partition query** — O(1) regardless of how many users exist. The 7-day TTL auto-expires old feed items.

---

### messages Table

| Column | Type | Role |
|--------|------|------|
| `conversation_id` | TEXT | **Partition Key** — all messages between two users in one partition |
| `created_at` | TIMESTAMP | **Clustering Key ASC** — chronological order |
| `message_id` | UUID | Unique ID |
| `sender_id`, `receiver_id` | UUID | Participants |
| `sender_name` | TEXT | Denormalized for display |
| `content` | TEXT | Message body |
| `is_read` | BOOLEAN | Read status |

| Method | Route | Purpose |
|--------|-------|---------|
| `sendMessage()` | `POST /api/messages` | Insert message into conversation partition |
| `getConversation(convId, limit)` | `GET /api/messages` | Read messages chronologically |
| `markMessagesAsRead()` | `GET /api/messages` | Update `is_read` flag for receiver |
| `generateConversationId(u1, u2)` | All message routes | Deterministic ID: sorted user IDs joined with `_` |

**Why Cassandra?** Messages are **time-series data** — always appended, read in order, partitioned by conversation. Cassandra handles this pattern at massive scale. Partition key ensures all messages between two users are co-located on disk.

---

### user_activity Table

| Column | Type | Role |
|--------|------|------|
| `user_id` | UUID | **Partition Key** |
| `created_at` | TIMESTAMP | **Clustering Key DESC** |
| `activity_type` | TEXT | `REVIEW`, `COMMENT`, `LIKE` |
| `beer_id`, `beer_name` | UUID, TEXT | Context |
| `rating`, `content` | FLOAT, TEXT | Optional details |

| Method | Route | Purpose |
|--------|-------|---------|
| `logActivity()` | `POST /api/reviews`, `POST /api/comments` | Append activity to user's log |
| `getUserActivity(userId, limit)` | Profile pages | Read activity history |

**Why Cassandra?** Append-only activity log with time-ordered reads. Each user's activity is a separate partition — no cross-user queries needed.

---

### beer_reviews_index Table

| Column | Type | Role |
|--------|------|------|
| `beer_id` | UUID | **Partition Key** — all reviews for a beer |
| `created_at` | TIMESTAMP | **Clustering Key DESC** |
| `review_id` | UUID | Reference |
| `user_id`, `user_name` | UUID, TEXT | Reviewer |
| `rating` | FLOAT | Score |
| `content` | TEXT | Body |

| Method | Route | Purpose |
|--------|-------|---------|
| `indexBeerReview()` | `POST /api/reviews` | Index review under the beer's partition |
| `getBeerReviews(beerId, limit)` | Beer detail pages | Fetch reviews by beer (alternative to MongoDB) |

**Why Cassandra?** Reverse index — partition by `beer_id` enables fast lookups of all reviews for a specific beer without scanning the entire reviews collection.

---

### followers / following Tables

| Table | Partition Key | Clustering Key | Purpose |
|-------|---------------|----------------|---------|
| `followers` | `user_id` (the followed user) | `follower_id` | "Who follows me?" |
| `following` | `user_id` (the follower) | `following_id` | "Who do I follow?" |

| Method | Route | Purpose |
|--------|-------|---------|
| `followUser(userId, followerId, name)` | `PUT /api/friends` (accept) | Batch insert into both tables |
| `getFollowers(userId)` | Profile | List followers |
| `getFollowing(userId)` | Profile | List following |

**Why Cassandra?** Two denormalized tables answer two different questions with single-partition reads. Written together in a batch for consistency. This is the **query-first design** pattern Cassandra excels at.

---

### rate_limiting Table

| Column | Type | Role |
|--------|------|------|
| `user_action` | TEXT | **Partition Key** — format: `{userId}:{action}` |
| `bucket_start` | TIMESTAMP | **Clustering Key** — time window start |
| `request_count` | COUNTER | Requests in this bucket |

| Method | Route | Limits |
|--------|-------|--------|
| `checkRateLimit(userId, action, max, windowSec)` | `POST /api/reviews` | 5 reviews per hour |
| `checkRateLimit(userId, action, max, windowSec)` | `POST /api/comments` | 20 comments per hour |

**Why Cassandra?** Distributed counters with time-bucketed partitions. Each rate limit check is a single partition read + counter increment — no locking, no transactions needed.

---

## Real-Time Architecture (SSE + Redis Pub/Sub)

```
 Browser (User B)                    Server                         Redis
 ┌─────────────┐              ┌──────────────────┐           ┌──────────────┐
 │ EventSource │─── SSE ─────▶│ /api/realtime    │◀── SUB ──│  Pub/Sub     │
 │ Header.tsx  │              │ (per-user stream) │           │  Channels    │
 └──────┬──────┘              └──────────────────┘           └──────┬───────┘
        │                                                           │
        │ dispatches window events:                                 │ PUB
        │ • beersocial:refreshFeed                                  │
        │ • beersocial:refreshNotifications                  ┌──────┴───────┐
        │                                                    │ API Routes   │
        ▼                                                    │ (POST/PUT)   │
 ┌─────────────┐                                             │ beers,reviews│
 │ page.tsx    │                                             │ likes,friends│
 │ loadData()  │                                             └──────────────┘
 └─────────────┘
```

### Event Flow Example

1. **User A** creates a review → `POST /api/reviews`
2. Server writes to **MongoDB** (review) + **Cassandra** (timeline, activity, index) + **Redis** (cache invalidation, leaderboard)
3. Server publishes to **Redis Pub/Sub**: `user:{followerB}:notifications` with `{ type: 'NEW_REVIEW' }`
4. `/api/realtime` (User B's SSE stream) receives the message → sends SSE event `notification`
5. **Header.tsx** receives SSE → dispatches `beersocial:refreshFeed` window event
6. **page.tsx** hears the event → calls `loadData()` → feed updates with the new review

### SSE Channels Summary

| Channel | Scope | Events |
|---------|-------|--------|
| `user:{id}:notifications` | Per-user | `NEW_REVIEW`, `NEW_LIKE`, `NEW_COMMENT`, `FRIEND_REQUEST`, `FRIEND_ACCEPTED` |
| `user:{id}:messages` | Per-user | `NEW_MESSAGE` (from a specific sender) |
| `beersocial:global` | All users | `NEW_BEER` (new beer added to catalogue) |

---

## Database Decision Matrix

| Requirement | MongoDB | Redis | Cassandra |
|-------------|---------|-------|-----------|
| **CRUD with flexible schema** | ✅ Primary | — | — |
| **Embedded documents (comments in reviews)** | ✅ `$push/$pull` | — | — |
| **Full-text search** | ✅ Text indexes | — | — |
| **Authentication & user profiles** | ✅ Users collection | ✅ Session hashes | — |
| **Sub-millisecond reads** | — | ✅ Cache strings | — |
| **Atomic counters** | — | ✅ `INCR/DECR` | ✅ Counter columns |
| **Leaderboards / rankings** | — | ✅ Sorted sets | — |
| **Real-time notifications** | ✅ Persist | ✅ Pub/Sub delivery | — |
| **Rate limiting** | — | — | ✅ Counter + time bucket |
| **Fan-out feed / timeline** | — | — | ✅ Partition per user |
| **Message history** | ✅ Conversation metadata | — | ✅ Time-series messages |
| **Activity log** | — | — | ✅ Append-only per user |
| **Online status** | — | ✅ Sets with TTL | — |
| **Search history** | — | ✅ Capped lists | — |

---

## Use Case Matrix

| Scenario | MongoDB | Redis | Cassandra |
|----------|---------|-------|-----------|
| User creates beer | ✅ Insert to beers | ✅ Invalidate cache, Pub/Sub `NEW_BEER` | — |
| User writes review | ✅ Insert to reviews | ✅ Invalidate cache, update leaderboard, Pub/Sub | ✅ Fan-out to timeline, log activity, index beer review |
| User likes review | ✅ `$push` to likes[] | ✅ INCR counter, update leaderboard, Pub/Sub | ✅ INCREMENT timeline likes_count |
| User adds comment | ✅ `$push` to comments[] | ✅ Invalidate cache, Pub/Sub | ✅ Log activity |
| User sends message | ✅ Conversation metadata | ✅ Pub/Sub to receiver | ✅ Insert message |
| User accepts friend | ✅ Update status | ✅ Invalidate cache, Pub/Sub | ✅ Insert followers/following |
| User logs in | ✅ Verify credentials | ✅ Create session, set online | — |
| Get feed | ✅ Query reviews | ✅ Check/set cache (30s) | ✅ Read user_timeline |
| Get conversation | ✅ Conversation metadata | — | ✅ Read messages |
| Rate limit check | — | — | ✅ Counter + time bucket |
| Search beers | ✅ Regex on name/style | ✅ Cache results (60s), track recent search | — |

---

## Docker Services

```yaml
# docker-compose.yml
beersocial-mongodb:    # port 27017 — primary data store
beersocial-redis:      # port 6379  — cache, sessions, pub/sub
beersocial-cassandra:  # port 9042  — timelines, messages, counters
```

## Running

Resumo rapido:

1. docker compose up -d
2. npm run dev
3. abrir http://localhost:3000

Para instrucoes completas e obrigatorias, seguir a secao 1

## Tech Stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **UI**: shadcn/ui + Tailwind CSS
- **Auth**: PBKDF2 password hashing + Redis sessions
- **Real-time**: SSE (Server-Sent Events) backed by Redis Pub/Sub
- **Package manager**: bun (dev) / npm (build)
