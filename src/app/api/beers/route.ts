import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// GET - List beers with search
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const style = searchParams.get('style') || '';
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where = {
      AND: [
        search ? {
          OR: [
            { name: { contains: search } },
            { brewery: { contains: search } }
          ]
        } : {},
        style ? { style: { contains: style } } : {}
      ]
    };

    const [beers, total] = await Promise.all([
      db.beer.findMany({
        where,
        include: {
          reviews: {
            select: { rating: true }
          },
          _count: {
            select: { reviews: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      }),
      db.beer.count({ where })
    ]);

    // Calculate average rating
    const beersWithRating = beers.map(beer => {
      const avgRating = beer.reviews.length > 0
        ? beer.reviews.reduce((sum, r) => sum + r.rating, 0) / beer.reviews.length
        : 0;
      return {
        ...beer,
        avgRating: Math.round(avgRating * 10) / 10,
        reviewCount: beer._count.reviews
      };
    });

    return NextResponse.json({ beers: beersWithRating, total });
  } catch (error) {
    console.error('Get beers error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter cervejas' },
      { status: 500 }
    );
  }
}

// POST - Create new beer
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Não autenticado' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, brewery, style, abv, ibu, description, image, country } = body;

    if (!name || !brewery || !style || !abv) {
      return NextResponse.json(
        { error: 'Nome, cervejeira, estilo e ABV são obrigatórios' },
        { status: 400 }
      );
    }

    const beer = await db.beer.create({
      data: {
        name,
        brewery,
        style,
        abv: parseFloat(abv),
        ibu: ibu ? parseInt(ibu) : null,
        description,
        image,
        country
      }
    });

    return NextResponse.json({ beer });
  } catch (error) {
    console.error('Create beer error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar cerveja' },
      { status: 500 }
    );
  }
}
