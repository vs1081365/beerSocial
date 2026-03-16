/**
 * AUTH REGISTER ENDPOINT
 * 
 * Tecnologia: MongoDB (users) + Redis (sessões)
 */

import { NextRequest, NextResponse } from 'next/server';
import { registerUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name, username } = body;

    if (!email || !password || !name || !username) {
      return NextResponse.json(
        { error: 'Todos os campos são obrigatórios' },
        { status: 400 }
      );
    }

    const result = await registerUser(email, password, name, username);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      user: result.user,
      technology: {
        storage: 'MongoDB (users collection)',
        session: 'Redis (hash com TTL 24h)',
        indexes: ['email_1 (unique)', 'username_1 (unique)'],
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: 'Erro ao registar utilizador' },
      { status: 500 }
    );
  }
}
