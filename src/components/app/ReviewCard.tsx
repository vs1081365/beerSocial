'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Star, Heart, MessageSquare, Beer } from 'lucide-react';

interface ReviewCardProps {
  review: {
    id: string;
    rating: number;
    content: string | null;
    createdAt: string;
    user: {
      id: string;
      name: string;
      username: string;
      avatar: string | null;
    } | null;
    beer: {
      id: string;
      name: string;
      brewery: string;
      image: string | null;
    } | null;
    _count?: {
      comments: number;
      likes: number;
    };
  };
  currentUser: { id: string } | null;
  onUserClick: (userId: string) => void;
  onBeerClick: (beerId: string) => void;
  onCommentsClick: (review: any) => void;
  onLikeToggle: (reviewId: string, liked: boolean) => void;
}

export function ReviewCard({ 
  review, 
  currentUser,
  onUserClick, 
  onBeerClick, 
  onCommentsClick,
  onLikeToggle
}: ReviewCardProps) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(review._count?.likes || 0);

  useEffect(() => {
    if (currentUser && review?.id) {
      fetch(`/api/likes?reviewId=${review.id}`)
        .then(res => res.json())
        .then(data => setLiked(data.liked));
    }
  }, [currentUser, review?.id]);

  const handleLike = async () => {
    if (!currentUser || !review?.id) return;
    
    try {
      const res = await fetch('/api/likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: review.id })
      });
      const data = await res.json();
      setLiked(data.liked);
      setLikeCount(prev => data.liked ? prev + 1 : prev - 1);
      onLikeToggle(review.id, data.liked);
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating
                ? 'fill-amber-400 text-amber-400'
                : 'text-gray-300'
            }`}
          />
        ))}
      </div>
    );
  };

  // Safety check - return null if required data is missing
  if (!review?.user || !review?.beer) {
    return null;
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start gap-3">
          {/* Beer Image */}
          <div 
            className="w-16 h-16 rounded-lg overflow-hidden bg-amber-100 flex-shrink-0 cursor-pointer"
            onClick={() => onBeerClick(review.beer!.id)}
          >
            {review.beer.image ? (
              <img 
                src={review.beer.image} 
                alt={review.beer.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Beer className="h-8 w-8 text-amber-400" />
              </div>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div 
              className="font-semibold truncate cursor-pointer hover:text-amber-600"
              onClick={() => onBeerClick(review.beer!.id)}
            >
              {review.beer.name}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {review.beer.brewery}
            </div>
            {renderStars(review.rating)}
          </div>

          {/* User */}
          <div 
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => onUserClick(review.user!.id)}
          >
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium">{review.user.name}</div>
              <div className="text-xs text-muted-foreground">@{review.user.username}</div>
            </div>
            <Avatar className="h-8 w-8">
              <AvatarImage src={review.user.avatar || undefined} />
              <AvatarFallback>{review.user.name?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-4 pt-2">
        {review.content && (
          <p className="text-sm mb-3">{review.content}</p>
        )}
        
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {new Date(review.createdAt).toLocaleDateString('pt-PT', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })}
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => onCommentsClick(review)}
            >
              <MessageSquare className="h-4 w-4 mr-1" />
              {review._count?.comments || 0}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 px-2 ${liked ? 'text-red-500' : ''}`}
              onClick={handleLike}
            >
              <Heart className={`h-4 w-4 mr-1 ${liked ? 'fill-current' : ''}`} />
              {likeCount}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
