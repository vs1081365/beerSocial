import { NextResponse } from 'next/server';
import { logoutUser } from '@/lib/auth';

export async function POST() {
  try {
    await logoutUser();
    
    return NextResponse.json({ 
      success: true,
      technology: {
        session: 'Redis (deleted)',
        cookie: 'HTTP-only (cleared)',
      }
    });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Erro ao fazer logout' },
      { status: 500 }
    );
  }
}
