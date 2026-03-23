/**
 * Authentication Library
 * 
 * Tecnologias:
 * - MongoDB: armazenamento de utilizadores (documentos)
 * - Redis: sessões (hashes com TTL)
 * - Cassandra: timeline e mensagens do utilizador
 */

import { cookies } from 'next/headers';
import { getMongoDB } from './mongodb-client';
import { getRedis } from './redis-client';

const SESSION_COOKIE = 'beersocial_session';
const SESSION_TTL = 86400; // 24 horas

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar?: string;
}

// Hash de password com PBKDF2 e salt único por utilizador
function generateSalt(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${salt}:${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hashHex === hash;
}

// Registrar utilizador
export async function registerUser(
  email: string,
  password: string,
  name: string,
  username: string
): Promise<{ success: boolean; user?: SessionUser; error?: string }> {
  try {
    const mongo = await getMongoDB();
    
    // Verificar se email já existe
    const existingEmail = await mongo.getUserByEmail(email);
    if (existingEmail) {
      return { success: false, error: 'Email já registado' };
    }
    
    // Verificar se username já existe
    const existingUsername = await mongo.getUserByUsername(username);
    if (existingUsername) {
      return { success: false, error: 'Username já existe' };
    }
    
    // Hash da password
    const hashedPassword = await hashPassword(password);
    
    // Criar utilizador no MongoDB
    const user = await mongo.createUser({
      email,
      password: hashedPassword,
      name,
      username,
    });
    
    // Criar sessão no Redis
    await createSession({
      id: user._id,
      email: user.email,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
    });
    
    return {
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
      }
    };
  } catch (error) {
    console.error('Register error:', error);
    return { success: false, error: 'Erro ao registar utilizador' };
  }
}

// Login
export async function loginUser(
  email: string,
  password: string
): Promise<{ success: boolean; user?: SessionUser; error?: string }> {
  try {
    const mongo = await getMongoDB();
    
    // Encontrar utilizador no MongoDB
    const user = await mongo.getUserByEmail(email);
    if (!user) {
      return { success: false, error: 'Credenciais inválidas' };
    }
    
    // Verificar password
    const passwordValid = await verifyPassword(password, user.password);
    if (!passwordValid) {
      return { success: false, error: 'Credenciais inválidas' };
    }
    
    // Criar sessão no Redis
    await createSession({
      id: user._id,
      email: user.email,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
    });
    
    return {
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
      }
    };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: 'Erro ao fazer login' };
  }
}

// Criar sessão (Redis Hash)
async function createSession(user: SessionUser): Promise<void> {
  const redis = await getRedis();
  const cookieStore = await cookies();
  const previousSessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (previousSessionId) {
    const previousSessionData = await redis.getSession(previousSessionId);

    if (previousSessionData?.userId) {
      await redis.deleteCache(`user_session:${previousSessionData.userId}`);
    }

    await redis.deleteSession(previousSessionId);
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 18)}`;
  
  // Guardar sessão no Redis como Hash
  await redis.createSession(sessionId, {
    userId: user.id,
    email: user.email,
    name: user.name,
    createdAt: Date.now(),
    lastAccess: Date.now(),
  });
  
  // Guardar mapping user -> session
  await redis.setCache(`user_session:${user.id}`, sessionId, SESSION_TTL);
  
  // Definir cookie
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL,
    path: '/',
  });
}

// Obter utilizador atual
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    
    if (!sessionId) {
      return null;
    }
    
    const redis = await getRedis();
    const sessionData = await redis.getSession(sessionId);
    
    if (!sessionData) {
      return null;
    }
    
    // Atualizar último acesso
    await redis.updateSessionAccess(sessionId);
    
    // Obter dados completos do user do MongoDB
    const mongo = await getMongoDB();
    const user = await mongo.getUserById(sessionData.userId);
    
    if (!user) {
      return null;
    }
    
    return {
      id: user._id,
      email: user.email,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
    };
  } catch (error) {
    console.error('Get current user error:', error);
    return null;
  }
}

// Logout
export async function logoutUser(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    
    if (sessionId) {
      const redis = await getRedis();
      const sessionData = await redis.getSession(sessionId);
      
      if (sessionData) {
        await redis.deleteCache(`user_session:${sessionData.userId}`);
      }
      
      await redis.deleteSession(sessionId);
    }
    
    cookieStore.delete(SESSION_COOKIE);
  } catch (error) {
    console.error('Logout error:', error);
  }
}

// Alias para compatibilidade
export { logoutUser as deleteSession };

// Obter ID do utilizador atual
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    
    if (!sessionId) {
      return null;
    }
    
    const redis = await getRedis();
    const sessionData = await redis.getSession(sessionId);
    
    return sessionData?.userId || null;
  } catch {
    return null;
  }
}
