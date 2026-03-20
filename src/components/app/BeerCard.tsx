'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Star, Beer, MessageSquare } from 'lucide-react';

interface BeerCardProps {
  beer: {
    id: string;
    name: string;
    brewery: string;
    style: string;
    abv: number;
    ibu: number | null;
    image: string | null;
    avgRating: number;
    reviewCount: number;
  };
  onClick: () => void;
}

export function BeerCard({ beer, onClick }: BeerCardProps) {
  return (
    <Card 
      className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
      onClick={onClick}
    >
      <div className="aspect-square relative bg-white overflow-hidden">
        {beer.image ? (
          <img 
            src={beer.image} 
            alt={beer.name}
            className="w-full h-full object-contain object-center"
            loading="lazy"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              display: 'block'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Beer className="h-20 w-20 text-amber-400" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge className="bg-white/90 text-amber-700 hover:bg-white">
            <Star className="h-3 w-3 mr-1 fill-amber-400 text-amber-400" />
            {beer.avgRating.toFixed(1)}
          </Badge>
        </div>
      </div>
      <CardContent className="p-3">
        <h3 className="font-semibold truncate">{beer.name}</h3>
        <p className="text-sm text-muted-foreground truncate">{beer.brewery}</p>
        <div className="flex items-center justify-between mt-2">
          <Badge variant="secondary" className="text-xs">
            {beer.style}
          </Badge>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            {beer.reviewCount}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs">
          <Badge variant="outline">{beer.abv}% ABV</Badge>
          {beer.ibu && <Badge variant="outline">{beer.ibu} IBU</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}
