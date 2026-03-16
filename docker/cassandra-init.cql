-- Cassandra Init Script
-- Modelação orientada às queries com partition key e clustering explícitos

-- ============================================
-- KEYSPACE: beersocial
-- Replication factor adequado para desenvolvimento
-- ============================================
CREATE KEYSPACE IF NOT EXISTS beersocial
WITH REPLICATION = {
    'class': 'SimpleStrategy',
    'replication_factor': 1
};

USE beersocial;

-- ============================================
-- TABLE: user_timeline (Feed do utilizador)
-- Query: Obter feed de um utilizador ordenado por tempo
-- Partition Key: user_id (distribui por nodes)
-- Clustering Key: created_at DESC (ordena por tempo)
-- ============================================
CREATE TABLE IF NOT EXISTS user_timeline (
    user_id UUID,
    created_at TIMESTAMP,
    review_id UUID,
    author_id UUID,
    author_name TEXT,
    beer_id UUID,
    beer_name TEXT,
    beer_style TEXT,
    rating DECIMAL,
    content TEXT,
    likes_count INT,
    comments_count INT,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND default_time_to_live = 604800; -- TTL: 7 dias

-- ============================================
-- TABLE: messages (Mensagens privadas)
-- Query: Obter conversa entre dois utilizadores
-- Partition Key: conversation_id (ambos users)
-- Clustering Key: created_at ASC (ordem cronológica)
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
    conversation_id TEXT,  -- hash de user1_id + user2_id
    created_at TIMESTAMP,
    message_id UUID,
    sender_id UUID,
    receiver_id UUID,
    sender_name TEXT,
    content TEXT,
    is_read BOOLEAN,
    PRIMARY KEY (conversation_id, created_at)
) WITH CLUSTERING ORDER BY (created_at ASC);

-- ============================================
-- TABLE: notifications (Notificações)
-- Query: Obter notificações de um utilizador
-- Partition Key: user_id
-- Clustering Key: created_at DESC
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    user_id UUID,
    created_at TIMESTAMP,
    notification_id UUID,
    type TEXT,
    title TEXT,
    message TEXT,
    data TEXT,
    is_read BOOLEAN,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC)
  AND default_time_to_live = 2592000; -- TTL: 30 dias

-- ============================================
-- TABLE: user_activity (Atividade do utilizador)
-- Query: Obter atividade recente de um utilizador
-- Partition Key: user_id
-- Clustering Key: created_at DESC
-- ============================================
CREATE TABLE IF NOT EXISTS user_activity (
    user_id UUID,
    created_at TIMESTAMP,
    activity_id UUID,
    activity_type TEXT,
    beer_id UUID,
    beer_name TEXT,
    rating DECIMAL,
    content TEXT,
    PRIMARY KEY (user_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC);

-- ============================================
-- TABLE: beer_reviews_index (Índice inverso)
-- Query: Obter todas as reviews de uma cerveja
-- Partition Key: beer_id
-- Clustering Key: created_at DESC
-- ============================================
CREATE TABLE IF NOT EXISTS beer_reviews_index (
    beer_id UUID,
    created_at TIMESTAMP,
    review_id UUID,
    user_id UUID,
    user_name TEXT,
    rating DECIMAL,
    content TEXT,
    PRIMARY KEY (beer_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC);

-- ============================================
-- TABLE: followers (Seguidores)
-- Query: Obter seguidores/following de um utilizador
-- Partition Key: user_id
-- Clustering Key: follower_id
-- ============================================
CREATE TABLE IF NOT EXISTS followers (
    user_id UUID,
    follower_id UUID,
    follower_name TEXT,
    followed_at TIMESTAMP,
    PRIMARY KEY (user_id, follower_id)
);

-- Tabela inversa para following
CREATE TABLE IF NOT EXISTS following (
    user_id UUID,
    following_id UUID,
    following_name TEXT,
    followed_at TIMESTAMP,
    PRIMARY KEY (user_id, following_id)
);

-- ============================================
-- TABLE: rate_limiting (Rate limiting)
-- Query: Verificar rate limit de um utilizador
-- Partition Key: user_id + action
-- ============================================
CREATE TABLE IF NOT EXISTS rate_limiting (
    user_action TEXT,
    bucket_start TIMESTAMP,
    request_count COUNTER,
    PRIMARY KEY (user_action, bucket_start)
);
