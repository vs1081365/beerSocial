'use client';

import { useState, useEffect } from 'react';
import { ReviewCard } from './ReviewCard';
import { Loader2 } from 'lucide-react';

interface MyReviewsProps {
  userId: string;
  onBeerClick: (beerId: string) => void;
  onUserClick: (userId: string) => void;
  onOpenComments: (review: any) => void;
  onLikeToggle: (reviewId: string, liked: boolean) => void;
  currentUser: { id: string } | null;
}

export function MyReviews({
  userId,
  onBeerClick,
  onUserClick,
  onOpenComments,
  onLikeToggle,
  currentUser
}: MyReviewsProps) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchReviews();
  }, [userId]);

  const fetchReviews = async () => {
    try {
      const res = await fetch(`/api/reviews?userId=${userId}`);
      const data = await res.json();
      setReviews(data.reviews);
    } catch (error) {
      console.error('Error fetching reviews:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          Ainda não fizeste nenhuma review. Avalia uma cerveja para começar!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reviews.map((review) => (
        <ReviewCard
          key={review.id}
          review={review}
          currentUser={currentUser}
          onUserClick={onUserClick}
          onBeerClick={onBeerClick}
          onCommentsClick={onOpenComments}
          onLikeToggle={onLikeToggle}
        />
      ))}
    </div>
  );
}