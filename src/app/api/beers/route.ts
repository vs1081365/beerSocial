/**
 * BEERS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB
 * PROPÓSITO: Catálogo de cervejas
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';
import { publishBeerCreatedEvent } from '@/lib/realtime/beer-events';

function summarizeBeerField(value: unknown) {
  if (typeof value === 'string') {
    return {
      type: 'string',
      length: value.length,
      preview: value.slice(0, 120),
    };
  }

  if (typeof value === 'number') {
    return { type: 'number', value };
  }

  if (value === null) {
    return { type: 'null' };
  }

  if (value === undefined) {
    return { type: 'undefined' };
  }

  return { type: typeof value };
}

// GET - Listar cervejas
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const style = searchParams.get('style') || '';
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const mongo = await getMongoDB();
    
    const filter: { search?: string; style?: string } = {};
    if (search) filter.search = search;
    if (style) filter.style = style;
    
    const beers = await mongo.getBeers(filter, limit, offset);
    const total = await mongo.countBeers(filter);

    // Add ratings and review counts for each beer
    const beersWithStats = await Promise.all(
      beers.map(async (beer) => {
        const stats = await mongo.getBeerReviewStats(beer._id);
        return {
          id: beer._id,
          name: beer.name,
          brewery: beer.brewery,
          style: beer.style,
          abv: beer.abv,
          ibu: beer.ibu,
          image: beer.image,
          avgRating: stats.avgRating,
          reviewCount: stats.totalReviews,
        };
      })
    );

    const result = {
      technology: {
        storage: 'MongoDB (beers collection)',
        indexes: ['name_1', 'brewery_1', 'style_1'],
      },
      beers: beersWithStats,
      total,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get beers error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter cervejas' },
      { status: 500 }
    );
  }
}

// POST - Criar cerveja
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { name, brewery, style, abv, ibu, description, image, country } = body;

    console.info('Create beer request received', {
      userId: user.id,
      payload: {
        name: summarizeBeerField(name),
        brewery: summarizeBeerField(brewery),
        style: summarizeBeerField(style),
        abv: summarizeBeerField(abv),
        ibu: summarizeBeerField(ibu),
        description: summarizeBeerField(description),
        image: summarizeBeerField(image),
        country: summarizeBeerField(country),
      },
    });

    if (!name || !brewery || !style || !abv) {
      return NextResponse.json(
        { error: 'Nome, cervejeira, estilo e ABV são obrigatórios' },
        { status: 400 }
      );
    }

    const mongo = await getMongoDB();

    const beerInput = {
      name,
      brewery,
      style,
      abv: parseFloat(abv),
      ibu: ibu ? parseInt(ibu) : undefined,
      description,
      image,
      country,
      createdBy: user.id,
    };

    console.info('Create beer input prepared', {
      userId: user.id,
      beerInput: {
        name: summarizeBeerField(beerInput.name),
        brewery: summarizeBeerField(beerInput.brewery),
        style: summarizeBeerField(beerInput.style),
        abv: summarizeBeerField(beerInput.abv),
        ibu: summarizeBeerField(beerInput.ibu),
        description: summarizeBeerField(beerInput.description),
        image: summarizeBeerField(beerInput.image),
        country: summarizeBeerField(beerInput.country),
        createdBy: summarizeBeerField(beerInput.createdBy),
      },
    });

    const beer = await mongo.createBeer(beerInput);

    console.info('Beer created successfully', {
      beerId: beer._id,
      userId: user.id,
      name: beer.name,
    });

    const normalizedBeer = {
      id: beer._id,
      ...beer,
    };

    await publishBeerCreatedEvent({
      type: 'BEER_CREATED',
      beerId: normalizedBeer.id,
      name: normalizedBeer.name,
      brewery: normalizedBeer.brewery,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    });

    console.info('Beer created event published', {
      beerId: normalizedBeer.id,
      userId: user.id,
    });

    return NextResponse.json({
      technology: { storage: 'MongoDB' },
      beer: normalizedBeer,
    }, { status: 201 });
  } catch (error) {
    console.error('Create beer error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar cerveja' },
      { status: 500 }
    );
  }
}
