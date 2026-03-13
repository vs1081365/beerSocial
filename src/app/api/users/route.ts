import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Search users
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const limit = parseInt(searchParams.get('limit') || '10');

    const users = await db.user.findMany({
      where: search ? {
        OR: [
          { name: { contains: search } },
          { username: { contains: search } }
        ]
      } : {},
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        bio: true,
        _count: {
          select: {
            reviews: true
          }
        }
      },
      take: limit
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Search users error:', error);
    return NextResponse.json(
      { error: 'Erro ao pesquisar utilizadores' },
      { status: 500 }
    );
  }
}
