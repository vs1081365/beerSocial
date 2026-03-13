import { db } from './db';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

const SESSION_COOKIE = 'beersocial_session';
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

// Simple hash function for passwords (in production, use bcrypt)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'beersocial_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

// Session management (simplified - using memory store)
const sessions = new Map<string, { userId: string; expires: number }>();

export async function createSession(userId: string): Promise<string> {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    userId,
    expires: Date.now() + SESSION_EXPIRY
  });
  return sessionId;
}

export async function getSession(sessionId: string): Promise<{ userId: string } | null> {
  const session = sessions.get(sessionId);
  if (!session || session.expires < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { userId: session.userId };
}

export async function deleteSession(sessionId: string): Promise<void> {
  sessions.delete(sessionId);
}

export async function getCurrentUser(): Promise<{
  id: string;
  email: string;
  name: string;
  username: string;
  avatar: string | null;
  bio: string | null;
  location: string | null;
  favoriteBeer: string | null;
} | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  
  if (!sessionId) return null;
  
  const session = await getSession(sessionId);
  if (!session) return null;
  
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      avatar: true,
      bio: true,
      location: true,
      favoriteBeer: true
    }
  });
  
  return user;
}

export function setSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_EXPIRY / 1000}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
