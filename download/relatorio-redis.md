# Relatório Técnico — Redis na BeerSocial

---

## 1. Papel do Redis na Arquitetura

O Redis é utilizado como **camada de dados auxiliar de alta velocidade**, complementando o MongoDB (persistência principal) e o Cassandra (dados distribuídos). Opera inteiramente **in-memory**, garantindo latência sub-milissegundo em todas as operações.

**Palavras-chave:** *in-memory store*, *low-latency*, *data structures server*, *ephemeral data*, *hot data layer*

---

## 2. Organização de Chaves — Namespacing

Todas as chaves seguem um esquema de prefixo sistemático:

```
cache:      → cache de queries
session:    → sessões de utilizador
counter:    → contadores atómicos
rate:       → rate limiting
lb:         → leaderboards
online:     → utilizadores online
views:beer: → views de cervejas
search:     → pesquisas recentes
unread:     → mensagens não lidas
```

**Vantagem:** Evita colisões de chaves, facilita `SCAN` por padrão, permite invalidação seletiva por categoria.

---

## 3. Estruturas de Dados e Casos de Uso

### 3.1 Strings com TTL — Cache de Queries

**Estrutura Redis:** `STRING` via `SETEX`

**Implementação:**
```
SET  cache:beers:list         <JSON>  EX 60
SET  cache:reviews:beerXYZ    <JSON>  EX 30
GET  cache:beers:list
DEL  cache:beers:list          ← invalidação
```

**Padrão de acesso — Cache-Aside:**
1. API verifica `GET cache:{key}`
2. Cache hit → devolve imediatamente (sem query ao MongoDB)
3. Cache miss → query MongoDB → `SETEX cache:{key} <ttl> <valor>`

**TTLs configurados:**

| Recurso | TTL | Justificação |
|---------|-----|--------------|
| Lista de cervejas | 60s | Dados mudam frequentemente |
| Reviews de uma cerveja | 30s | Comentários/likes em tempo real |
| Sessão | 86400s (24h) | Persistência de login |

**Política de invalidação:** Quando uma review é criada (`POST /api/reviews`), o código invalida explicitamente:
```typescript
await redis.deleteCache(`reviews:${beerId}`);
await redis.invalidatePattern('beers:*');  // KEYS cache:beers:* → DEL
```

**Palavras-chave:** *cache-aside pattern*, *TTL-based expiration*, *write-through invalidation*, *hot path optimization*

---

### 3.2 Hashes — Sessões de Utilizador

**Estrutura Redis:** `HASH` via `HSET` / `HGETALL`

**Modelação:**
```
HSET session:sess_1234_abc  userId "u1"  email "a@b.com"  name "Ana"
                            createdAt "1710000000"  lastAccess "1710001000"
EXPIRE session:sess_1234_abc 86400
```

**Padrão de acesso:**
- Login → `HSET` + `EXPIRE 86400`
- Cada request autenticado → `HGETALL` (validação) + `HSET lastAccess` (atualização)
- Logout → `DEL session:{id}`

**Porquê Hash e não String?** Um Hash permite atualizar campos individuais (`HSET lastAccess`) sem reescrever toda a estrutura serializada. Mais eficiente em memória que JSON string para objetos com múltiplos campos.

**Palavras-chave:** *field-level updates*, *structured sessions*, *TTL per key*, *O(1) field access*

---

### 3.3 Hashes — Mensagens Não Lidas por Chat

**Estrutura Redis:** `HASH` via `HINCRBY` / `HLEN` / `HDEL`

```
HINCRBY unread:{userId}  {senderId}  1    ← nova mensagem de senderId
HLEN    unread:{userId}               ← nº de chats com não lidos
HDEL    unread:{userId}  {senderId}   ← abriu o chat → limpa esse remetente
```

**Lógica:** Cada campo do hash = um remetente. O valor é o contador de mensagens não lidas desse remetente. O badge mostra `HLEN` (número de chats distintos com não lidos), não a soma total.

**Palavras-chave:** *per-field counters*, *atomic increment*, *selective deletion*

---

### 3.4 Strings INCR/DECR — Contadores Atómicos

**Estrutura Redis:** `STRING` via `INCR` / `DECR`

```
INCR counter:beer:{beerId}:likes    ← like
DECR counter:beer:{beerId}:likes    ← unlike
GET  counter:beer:{beerId}:likes
```

**Porquê Redis e não MongoDB?** `INCR` é **atómico por design** — sem race conditions, sem transações, sem locks. Dois utilizadores a dar like simultaneamente nunca perdem um incremento.

**Palavras-chave:** *atomic increment*, *race-condition free*, *O(1) complexity*, *optimistic concurrency*

---

### 3.5 Hashes — Views de Cervejas por Dia (Trending)

**Estrutura Redis:** `HASH` com TTL de 7 dias

```
HINCRBY views:beer:2026-03-20  {beerId}  1
HGETALL views:beer:2026-03-20              ← todos os beers do dia
EXPIRE  views:beer:2026-03-20  604800      ← 7 dias
```

**Padrão:** A chave muda todos os dias (data como parte da chave). Dados históricos expiram automaticamente. Para trending, ordena-se por valor no lado da aplicação.

**Palavras-chave:** *time-bucketed keys*, *automatic expiration*, *trending detection*

---

### 3.6 Sorted Sets (ZSET) — Leaderboards

**Estrutura Redis:** `SORTED SET` via `ZADD` / `ZREVRANGE`

```
ZADD lb:beers:rating   4.7  "beer_abc"     ← atualiza rating
ZADD lb:users:reviews  23   "user_xyz"     ← nº reviews do user

ZREVRANGE lb:beers:rating   0 9 WITHSCORES  ← top 10 cervejas
ZREVRANGE lb:users:reviews  0 9 WITHSCORES  ← top 10 reviewers
```

**Vantagem estrutural:** O Sorted Set mantém os elementos **sempre ordenados** por score. Inserção em `O(log N)`, consulta do top N em `O(log N + N)`. Equivalente a um `ORDER BY rating DESC LIMIT 10` sem custo de query.

**Palavras-chave:** *real-time leaderboard*, *O(log N) insert*, *ranked data structure*, *score-based ordering*

---

### 3.7 Sorted Sets — Rate Limiting Sliding Window

**Estrutura Redis:** `SORTED SET` com **Lua Script atómico**

```lua
ZREMRANGEBYSCORE rate:login_fail:{ip}  0  {now - 900000}  ← remove > 15min
ZCARD            rate:login_fail:{ip}                      ← conta na janela
ZADD             rate:login_fail:{ip}  {now}  "{now}-rand" ← regista pedido
EXPIRE           rate:login_fail:{ip}  900
```

**Aplicado em:**
- `POST /api/auth/login` → 5 tentativas / 15 minutos por IP (proteção brute force)

**Porquê Lua Script?** As 4 operações acima têm de ser executadas atomicamente. O Lua corre no servidor Redis como uma transação — sem risco de outro cliente interromper entre o `ZCARD` e o `ZADD`.

**Sliding window vs Fixed window:** A janela deslizante evita o "boundary burst" (ex: 10 pedidos em 2 segundos no cruzamento de duas janelas fixas).

```
Fixed window:    [00:00 --- 01:00] | [01:00 --- 02:00]
                  10 req às 00:59    10 req às 01:01  → 20 req em 2s ✗

Sliding window:  "Últimos 60s a partir de agora"
                  Nunca mais de 10 req em qualquer janela de 60s         ✓
```

**Palavras-chave:** *sliding window rate limiting*, *Lua scripting*, *server-side atomicity*, *brute force protection*, *OWASP A07*

---

### 3.8 Sets — Utilizadores Online

**Estrutura Redis:** `SET` via `SADD` / `SISMEMBER` / `SCARD`

```
SADD      online:2026-03-20  {userId}    ← login
SISMEMBER online:2026-03-20  {userId}    ← está online?
SCARD     online:2026-03-20              ← quantos online hoje
EXPIRE    online:2026-03-20  86400       ← expira a meia-noite
```

**Palavras-chave:** *membership testing O(1)*, *set cardinality*, *daily active users*

---

### 3.9 Lists — Pesquisas Recentes

**Estrutura Redis:** `LIST` via `LPUSH` / `LREM` / `LTRIM`

```
LREM   search:{userId}  0  "IPA"    ← remove duplicado
LPUSH  search:{userId}  "IPA"       ← adiciona ao topo
LTRIM  search:{userId}  0  9        ← mantém só últimas 10
LRANGE search:{userId}  0  9        ← obter lista
EXPIRE search:{userId}  3600
```

**Vantagem:** `LREM` + `LPUSH` + `LTRIM` em sequência garante lista sem duplicados, ordenada por recência, com tamanho máximo fixo — tudo sem queries complexas.

**Palavras-chave:** *LRU-like list*, *deduplication*, *bounded list*, *recency ordering*

---

### 3.10 Pub/Sub — Notificações em Tempo Real

**Mecanismo:** Canal de mensagens sem persistência.

```
PUBLISH user:{userId}:notifications  <JSON>    ← servidor publica
PUBLISH user:{userId}:messages       <JSON>
PUBLISH beersocial:global            <JSON>    ← eventos globais (novo beer)

SUBSCRIBE user:{userId}:notifications           ← SSE endpoint subscreve
```

**Fluxo completo:**
```
Utilizador A faz review
    → POST /api/reviews
    → MongoDB guarda review
    → Redis PUBLISH user:{seguidor}:notifications
    → /api/realtime (SSE endpoint) recebe mensagem
    → Envia Server-Sent Event ao browser do seguidor
    → Header.tsx atualiza badge de notificações em tempo real
```

**Canais implementados:**

| Canal | Evento | Subscritor |
|-------|--------|------------|
| `user:{id}:notifications` | NEW_REVIEW, NEW_LIKE, NEW_COMMENT, FRIEND_REQUEST | SSE por user |
| `user:{id}:messages` | NEW_MESSAGE | SSE por user |
| `beersocial:global` | NEW_BEER | Todos os SSE ativos |

**Palavras-chave:** *event-driven architecture*, *fan-out pattern*, *Server-Sent Events*, *decoupled communication*, *real-time push*

---

## 4. Resumo das Estruturas por Caso de Uso

| Caso de Uso | Estrutura Redis | Comando Principal | TTL |
|-------------|-----------------|-------------------|-----|
| Cache de queries | String | `SETEX` / `GET` | 30–60s |
| Sessões | Hash | `HSET` / `HGETALL` / `EXPIRE` | 86400s |
| Likes/contadores | String INCR | `INCR` / `DECR` | Sem TTL |
| Views por dia | Hash | `HINCRBY` / `HGETALL` | 7 dias |
| Leaderboards | Sorted Set | `ZADD` / `ZREVRANGE` | Sem TTL |
| Rate limiting | Sorted Set + Lua | `ZREMRANGEBYSCORE` / `ZCARD` / `ZADD` | Janela |
| Mensagens não lidas | Hash | `HINCRBY` / `HLEN` / `HDEL` | Sem TTL |
| Utilizadores online | Set | `SADD` / `SCARD` / `SISMEMBER` | 24h |
| Pesquisas recentes | List | `LPUSH` / `LTRIM` / `LRANGE` | 1h |
| Notificações real-time | Pub/Sub | `PUBLISH` / `SUBSCRIBE` | N/A |

---

## 5. Decisões de Modelação

1. **Redis não é BD principal** — dados críticos (utilizadores, reviews, amizades) persistem sempre no MongoDB. Redis guarda apenas dados derivados ou efémeros.

2. **TTL como política de consistência** — em vez de invalidação complexa, TTLs curtos garantem que dados desatualizados expiram naturalmente (aceita-se *eventual consistency* na cache).

3. **Invalidação explícita no write path** — em operações críticas (criar review, like), a cache é invalidada imediatamente para garantir que a próxima leitura reflete o estado real.

4. **Estrutura escolhida pelo padrão de acesso:**
   - Hash para sessões (update por campo individual)
   - Sorted Set para leaderboards (ordenação automática)
   - Set para presença online (membership O(1))
   - List para histórico com limite máximo

5. **Lua Script para atomicidade** — o rate limiter usa Lua para garantir que check + write é uma operação indivisível, eliminando race conditions sem usar `MULTI`/`EXEC`.
