import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';
import { cookies } from 'next/headers';
import { deleteSession } from '@/lib/auth';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('beersocial_session')?.value;
    
    if (sessionId) {
      await deleteSession(sessionId);
    }

    const response = NextResponse.json({ success: true });
    response.headers.set('Set-Cookie', clearSessionCookie());
    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Erro ao fazer logout' },
      { status: 500 }
    );
  }
}
