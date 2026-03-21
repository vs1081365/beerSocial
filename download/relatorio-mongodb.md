# Relatório Técnico — MongoDB na BeerSocial

---

## 1. Papel do MongoDB na Arquitetura

O MongoDB é a **base de dados principal** da aplicação, responsável por toda a persistência de dados estruturais. Utiliza o modelo **documental** (BSON/JSON), que permite armazenar dados heterogéneos e embedded sem necessidade de joins ou schemas rígidos.

Complementa o Redis (cache/real-time) e o Cassandra (mensagens/timeline distribuída), sendo o único que persiste dados críticos de forma durável.

**Palavras-chave:** *document model*, *BSON*, *schema-flexible*, *embedded documents*, *horizontal scalability*, *ACID per document*

---

## 2. Coleções — Modelação Documental

A base de dados `beersocial` contém **6 coleções**, cada uma correspondendo a um domínio distinto da aplicação.

### 2.1 Coleção `users`

**Propósito:** Contas de utilizador, autenticação e perfil.

**Documento exemplo:**
```json
{
  "_id": "user_1710000000_abc123",
  "email": "ana@exemplo.pt",
  "password": "pbkdf2:sha256:100000:salt:hash",
  "name": "Ana Silva",
  "username": "anasilva",
  "avatar": "https://...",
  "bio": "Apreciadora de IPAs",
  "location": "Porto",
  "favoriteBeer": "Super Bock Stout",
  "createdAt": "2026-03-20T10:00:00Z",
  "updatedAt": "2026-03-20T10:00:00Z"
}
```

**Índices:**
```
{ email: 1 }     unique  → login por email (O(log N))
{ username: 1 }  unique  → pesquisa por @username
```

**Operações representativas:**
```javascript
// Login
db.users.findOne({ email: "ana@exemplo.pt" })

// Pesquisa por nome ou username
db.users.find({
  $or: [
    { name: { $regex: "ana", $options: "i" } },
    { username: { $regex: "ana", $options: "i" } }
  ]
}).limit(20)

// Atualizar perfil
db.users.updateOne(
  { _id: "user_123" },
  { $set: { bio: "Nova bio", updatedAt: new Date() } }
)
```

---

### 2.2 Coleção `beers`

**Propósito:** Catálogo de cervejas criadas pelos utilizadores.

**Documento exemplo:**
```json
{
  "_id": "beer_1710000000_xyz789",
  "name": "Porto Lager",
  "brewery": "Cervejaria Invicta",
  "style": "Lager",
  "abv": 5.2,
  "ibu": 18,
  "description": "Uma lager suave com notas cítricas",
  "image": "https://...",
  "country": "Portugal",
  "createdBy": "user_1710000000_abc123",
  "createdAt": "2026-03-20T11:00:00Z",
  "updatedAt": "2026-03-20T11:00:00Z"
}
```

**Índices:**
```
{ name: 1 }      → pesquisa por nome
{ brewery: 1 }   → filtrar por cervejaria
{ style: 1 }     → filtrar por estilo
{ createdBy: 1 } → cervejas de um utilizador
```

**Operações representativas:**
```javascript
// Pesquisa com filtros (text search case-insensitive)
db.beers.find({
  $or: [
    { name: { $regex: "lager", $options: "i" } },
    { brewery: { $regex: "lager", $options: "i" } }
  ]
})
.sort({ createdAt: -1 })
.skip(0).limit(20)

// Contagem total para paginação
db.beers.countDocuments({
  style: { $regex: "IPA", $options: "i" }
})
```

**Nota — projeção segura:** Para evitar erros de leitura com campos corrompidos (encoding BSON/UTF-8), utiliza-se uma projeção explícita `BEER_SAFE_PROJECTION` que exclui o campo `description`:
```javascript
db.beers.find({}).project({ _id:1, name:1, brewery:1, style:1, abv:1, ibu:1, image:1, country:1, createdBy:1, createdAt:1, updatedAt:1 })
```

**Palavras-chave:** *case-insensitive search*, *$regex*, *projection*, *pagination with skip/limit*

---

### 2.3 Coleção `reviews` — Embedded Documents

**Propósito:** Reviews com comentários e likes **embeddidos** no mesmo documento.

Esta é a coleção com maior riqueza de modelação. Em vez de coleções separadas para comentários e likes (abordagem relacional), são **arrays dentro do documento de review** — padrão fundamental do modelo documental MongoDB.

**Documento exemplo:**
```json
{
  "_id": "review_1710000000_def456",
  "beerId": "beer_1710000000_xyz789",
  "beerName": "Porto Lager",
  "userId": "user_1710000000_abc123",
  "userName": "Ana Silva",
  "rating": 4.5,
  "content": "Excelente cerveja, muito refrescante!",
  "createdAt": "2026-03-20T12:00:00Z",
  "updatedAt": "2026-03-20T12:05:00Z",
  "comments": [
    {
      "userId": "user_222",
      "userName": "Bruno Costa",
      "userUsername": "brunocosta",
      "content": "Concordo totalmente!",
      "createdAt": "2026-03-20T12:03:00Z"
    }
  ],
  "likes": ["user_222", "user_333", "user_444"]
}
```

**Índices:**
```
{ beerId: 1, createdAt: -1 }            → reviews de uma cerveja ordenadas por data
{ userId: 1, createdAt: -1 }            → reviews de um utilizador
{ userId: 1, beerId: 1 }  unique        → um utilizador só pode avaliar uma cerveja uma vez
```

**Operações representativas:**
```javascript
// Reviews de uma cerveja (mais recentes primeiro)
db.reviews.find({ beerId: "beer_xyz" })
  .sort({ createdAt: -1 })
  .skip(0).limit(20)

// Adicionar comentário (update sem substituir documento)
db.reviews.updateOne(
  { _id: "review_abc" },
  {
    $push: {
      comments: {
        userId: "user_222",
        userName: "Bruno Costa",
        content: "Boa review!",
        createdAt: new Date()
      }
    },
    $set: { updatedAt: new Date() }
  }
)

// Adicionar like (evita duplicados com $ne)
db.reviews.updateOne(
  { _id: "review_abc", likes: { $ne: "user_222" } },
  {
    $push: { likes: "user_222" },
    $set: { updatedAt: new Date() }
  }
)

// Remover like
db.reviews.updateOne(
  { _id: "review_abc" },
  {
    $pull: { likes: "user_222" },
    $set: { updatedAt: new Date() }
  }
)

// Média de rating e total de reviews por cerveja (Aggregation Pipeline)
db.reviews.aggregate([
  { $match: { beerId: "beer_xyz" } },
  {
    $group: {
      _id: null,
      avgRating: { $avg: "$rating" },
      totalReviews: { $sum: 1 }
    }
  }
])
```

**Porquê embedded e não referências?**

| Critério | Embedded (escolhido) | Referências |
|----------|---------------------|-------------|
| Leitura de review completa | 1 query | 3 queries (review + comments + likes) |
| Escrita de comentário | `$push` num documento | INSERT numa coleção separada |
| Consistência | Atómica ao nível do documento | Precisa de transações |
| Uso típico | Leitura frequente com dados relacionados | Dados com vida própria e reutilizáveis |

**Palavras-chave:** *embedded documents*, *denormalization*, *$push*, *$pull*, *$ne guard*, *aggregation pipeline*, *atomic document update*

---

### 2.4 Coleção `friendships`

**Propósito:** Relações de amizade entre utilizadores (pedido → aceitação).

**Documento exemplo:**
```json
{
  "_id": "friend_1710000000_ghi789",
  "requesterId": "user_111",
  "requesterName": "Ana Silva",
  "addresseeId": "user_222",
  "addresseeName": "Bruno Costa",
  "status": "PENDING",
  "createdAt": "2026-03-20T13:00:00Z",
  "updatedAt": "2026-03-20T13:00:00Z"
}
```

**Status possíveis:** `PENDING` → `ACCEPTED` | `REJECTED`

**Índices:**
```
{ requesterId: 1, addresseeId: 1 }  unique → impede pedidos duplicados
{ addresseeId: 1, status: 1 }              → pedidos pendentes recebidos
{ requesterId: 1, status: 1 }             → pedidos enviados
```

**Operações representativas:**
```javascript
// Verificar se amizade já existe (qualquer direção)
db.friendships.findOne({
  $or: [
    { requesterId: "user_111", addresseeId: "user_222" },
    { requesterId: "user_222", addresseeId: "user_111" }
  ]
})

// Pedidos pendentes recebidos
db.friendships.find({
  addresseeId: "user_222",
  status: "PENDING"
})

// Todos os amigos aceites
db.friendships.find({
  $or: [
    { requesterId: "user_111", status: "ACCEPTED" },
    { addresseeId: "user_111", status: "ACCEPTED" }
  ]
})

// Aceitar pedido
db.friendships.updateOne(
  { _id: "friend_xyz" },
  { $set: { status: "ACCEPTED", updatedAt: new Date() } }
)
```

**Palavras-chave:** *bidirectional relationship*, *$or query*, *status state machine*, *unique compound index*

---

### 2.5 Coleção `notifications`

**Propósito:** Notificações geradas por eventos (novo like, comentário, pedido de amizade, mensagem).

**Documento exemplo:**
```json
{
  "_id": "notif_1710000000_jkl012",
  "userId": "user_222",
  "type": "NEW_LIKE",
  "title": "Novo Like",
  "message": "Ana Silva gostou da tua review",
  "data": "{\"reviewId\": \"review_abc\", \"beerId\": \"beer_xyz\"}",
  "isRead": false,
  "createdAt": "2026-03-20T14:00:00Z"
}
```

**Tipos de notificação:** `NEW_REVIEW`, `NEW_LIKE`, `NEW_COMMENT`, `FRIEND_REQUEST`, `FRIEND_ACCEPTED`, `NEW_MESSAGE`

**Campo `data`:** JSON serializado com contexto extra (ex: `beerId`, `senderId`) que permite navegação direta ao clicar na notificação.

**Índices:**
```
{ userId: 1, createdAt: -1 }  → notificações de um user ordenadas
{ userId: 1, isRead: 1 }      → contagem de não lidas (badge)
```

**Operações representativas:**
```javascript
// Notificações de um utilizador
db.notifications.find({ userId: "user_222" })
  .sort({ createdAt: -1 })
  .limit(20)

// Contagem de não lidas
db.notifications.countDocuments({
  userId: "user_222",
  isRead: false
})

// Marcar todas como lidas
db.notifications.updateMany(
  { userId: "user_222", isRead: false },
  { $set: { isRead: true } }
)
```

**Palavras-chave:** *event sourcing light*, *updateMany*, *compound index for badge count*

---

### 2.6 Coleção `conversations`

**Propósito:** Metadados das conversas de mensagens privadas. As mensagens em si estão no Cassandra — o MongoDB guarda apenas os participantes e a última mensagem (para preview na lista).

**Documento exemplo:**
```json
{
  "_id": "conv_1710000000_mno345",
  "participants": ["user_111", "user_222"],
  "participantNames": ["Ana Silva", "Bruno Costa"],
  "lastMessage": {
    "content": "Combinado para sexta!",
    "senderId": "user_111",
    "senderName": "Ana Silva",
    "createdAt": "2026-03-20T15:00:00Z"
  },
  "createdAt": "2026-03-20T14:00:00Z",
  "updatedAt": "2026-03-20T15:00:00Z"
}
```

**Índices:**
```
{ participants: 1 }  → conversas de um utilizador (array index)
{ updatedAt: -1 }    → ordenar por última atividade
```

**Nota:** O índice em `participants` (array) faz com que MongoDB indexe **cada elemento individualmente** — uma query `{ participants: "user_111" }` encontra todos os documentos onde `user_111` é participante, mesmo sendo um array.

**Operações representativas:**
```javascript
// Conversas de um utilizador ordenadas por atividade
db.conversations.find({ participants: "user_111" })
  .sort({ updatedAt: -1 })

// Atualizar preview após nova mensagem
db.conversations.updateOne(
  { _id: "conv_xyz" },
  {
    $set: {
      lastMessage: {
        content: "Combinado!",
        senderId: "user_111",
        senderName: "Ana Silva",
        createdAt: new Date()
      },
      updatedAt: new Date()
    }
  }
)
```

**Palavras-chave:** *array index*, *multikey index*, *hybrid storage* (MongoDB metadata + Cassandra messages)

---

## 3. Padrões de Acesso

| Padrão | Coleção | Operação MongoDB |
|--------|---------|-----------------|
| Login por email | users | `findOne({ email })` com índice único |
| Feed de reviews | reviews | `find({}).sort({ createdAt: -1 })` |
| Reviews de uma cerveja | reviews | `find({ beerId }).sort({ createdAt: -1 })` |
| Adicionar like | reviews | `updateOne` com `$push` + `$ne` guard |
| Média de rating | reviews | `aggregate` com `$group` + `$avg` |
| Pedidos de amizade pendentes | friendships | `find({ addresseeId, status: "PENDING" })` |
| Badge de notificações | notifications | `countDocuments({ userId, isRead: false })` |
| Lista de conversas | conversations | `find({ participants: userId }).sort({ updatedAt: -1 })` |

---

## 4. Índices — Tabela Completa

| Coleção | Índice | Tipo | Propósito |
|---------|--------|------|-----------|
| users | `{ email: 1 }` | Único | Login |
| users | `{ username: 1 }` | Único | Pesquisa por @username |
| beers | `{ name: 1 }` | Normal | Pesquisa por nome |
| beers | `{ brewery: 1 }` | Normal | Filtro por cervejaria |
| beers | `{ style: 1 }` | Normal | Filtro por estilo |
| beers | `{ createdBy: 1 }` | Normal | Cervejas de um user |
| reviews | `{ beerId: 1, createdAt: -1 }` | Composto | Reviews por cerveja, orderadas |
| reviews | `{ userId: 1, createdAt: -1 }` | Composto | Reviews de um user |
| reviews | `{ userId: 1, beerId: 1 }` | Único | Impede review duplicada |
| friendships | `{ requesterId: 1, addresseeId: 1 }` | Único | Impede pedido duplicado |
| friendships | `{ addresseeId: 1, status: 1 }` | Composto | Pedidos recebidos por status |
| friendships | `{ requesterId: 1, status: 1 }` | Composto | Pedidos enviados por status |
| notifications | `{ userId: 1, createdAt: -1 }` | Composto | Lista de notificações |
| notifications | `{ userId: 1, isRead: 1 }` | Composto | Contagem de não lidas |
| conversations | `{ participants: 1 }` | Multikey | Conversas de um user |
| conversations | `{ updatedAt: -1 }` | Normal | Ordenação por atividade |

---

## 5. Decisões de Modelação

1. **Embedded vs Referências em `reviews`:** Comentários e likes são embedded porque são sempre acedidos em conjunto com a review. Evita 2 queries extra por leitura — padrão *locality of reference*.

2. **`$ne` guard no like:** `updateOne({ _id, likes: { $ne: userId } }, { $push })` garante que um utilizador não pode dar like duas vezes, de forma atómica, sem transação.

3. **Aggregation Pipeline para estatísticas:** `$match` + `$group` + `$avg` calcula o rating médio diretamente no servidor sem trazer todos os documentos para a aplicação.

4. **Índices compostos na ordem correta:** `{ beerId: 1, createdAt: -1 }` serve tanto `find({ beerId }).sort({ createdAt: -1 })` como `find({ beerId })` simples, mas não o inverso — a ordem importa.

5. **Array index em `conversations.participants`:** MongoDB cria um *multikey index* automaticamente para arrays, permitindo `find({ participants: "userId" })` sem sintaxe especial.

6. **Separação MongoDB/Cassandra em mensagens:** O MongoDB guarda apenas os metadados da conversa (participantes, última mensagem para preview). As mensagens em si estão no Cassandra, otimizado para escritas sequenciais e leituras por partition key. Esta divisão evita documentos MongoDB com arrays de mensagens ilimitados.

7. **Sanitização BSON:** Todos os documentos passam por `prepareDocumentForWrite()` que normaliza strings UTF-8 (`NFC`) e valida a serialização BSON antes de escrever — proteção contra erros de encoding em dados externos.
