'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Star, Beer, ArrowLeft, Loader2, Heart, MessageSquare, MapPin, Eye } from 'lucide-react';

interface BeerDetailProps {
  beerId: string;
  currentUser: { id: string } | null;
  onBack: () => void;
  onUserClick: (userId: string) => void;
  onOpenComments: (review: any) => void;
  onLoginRequired: () => void;
}

export function BeerDetail({ 
  beerId, 
  currentUser, 
  onBack, 
  onUserClick,
  onOpenComments,
  onLoginRequired
}: BeerDetailProps) {
  const [beer, setBeer] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [rating, setRating] = useState(3);
  const [reviewContent, setReviewContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [likedReviews, setLikedReviews] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchBeer();
  }, [beerId]);

  const fetchBeer = async () => {
    try {
      const res = await fetch(`/api/beers/${beerId}`);
      const data = await res.json();
      setBeer(data.beer);
      setReviews(data.reviews || []);

      // Check which reviews are liked
      if (currentUser && data.reviews) {
        const liked = new Set<string>();
        for (const review of data.reviews) {
          const likeRes = await fetch(`/api/likes?reviewId=${review.id}`);
          const likeData = await likeRes.json();
          if (likeData.liked) liked.add(review.id);
        }
        setLikedReviews(liked);
      }
    } catch (error) {
      console.error('Error fetching beer:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onLoginRequired();
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beerId,
          rating,
          content: reviewContent
        })
      });

      if (res.ok) {
        setShowReviewForm(false);
        setReviewContent('');
        setRating(3);
        fetchBeer();

        // Notify header to refresh notifications (and counts)
        window.dispatchEvent(new Event('beersocial:refreshNotifications'));
      }
    } catch (error) {
      console.error('Error submitting review:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLike = async (reviewId: string) => {
    if (!currentUser) {
      onLoginRequired();
      return;
    }

    try {
      const res = await fetch('/api/likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId })
      });
      const data = await res.json();
      
      setLikedReviews(prev => {
        const newSet = new Set(prev);
        if (data.liked) {
          newSet.add(reviewId);
        } else {
          newSet.delete(reviewId);
        }
        return newSet;
      });

      // Update review like count
      setReviews(prev => prev.map(r => 
        r.id === reviewId 
          ? { ...r, _count: { ...r._count, likes: data.liked ? r._count.likes + 1 : r._count.likes - 1 } }
          : r
      ));
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  };

  const renderStars = (rating: number, size: 'sm' | 'lg' = 'sm') => {
    const sizeClass = size === 'lg' ? 'h-6 w-6' : 'h-4 w-4';
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`${sizeClass} ${
              star <= rating
                ? 'fill-amber-400 text-amber-400'
                : 'text-gray-300'
            }`}
          />
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!beer) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Cerveja não encontrada</p>
        <Button onClick={onBack} className="mt-4">Voltar</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button variant="ghost" onClick={onBack} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Voltar
      </Button>

      {/* Beer Header */}
      <Card>
        <div className="flex flex-col md:flex-row">
          {/* Beer Image */}
          <div className="w-full md:w-48 h-48 bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center flex-shrink-0">
            {beer.image ? (
              <img 
                src={beer.image} 
                alt={beer.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <Beer className="h-24 w-24 text-amber-400" />
            )}
          </div>
          
          <div className="flex-1 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold">{beer.name}</h1>
                <p className="text-lg text-muted-foreground">{beer.brewery}</p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1">
                  <Star className="h-6 w-6 fill-amber-400 text-amber-400" />
                  <span className="text-2xl font-bold">{beer.avgRating.toFixed(1)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {beer.reviewCount} avaliações
                </p>
                {beer.viewsToday > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Eye className="h-3 w-3" />
                    {beer.viewsToday} views hoje
                  </p>
                )}
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2 mt-4">
              <Badge>{beer.style}</Badge>
              <Badge variant="outline">{beer.abv}% ABV</Badge>
              {beer.ibu && <Badge variant="outline">{beer.ibu} IBU</Badge>}
              {beer.country && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {beer.country}
                </Badge>
              )}
            </div>
            
            {beer.description && (
              <p className="mt-4 text-muted-foreground">{beer.description}</p>
            )}

            {currentUser && (
              <Button 
                className="mt-4" 
                onClick={() => setShowReviewForm(!showReviewForm)}
              >
                {showReviewForm ? 'Cancelar' : 'Avaliar Cerveja'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Review Form */}
      {showReviewForm && (
        <Card>
          <CardHeader>
            <CardTitle>Avaliar {beer.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmitReview} className="space-y-4">
              <div className="space-y-2">
                <Label>Classificação: {rating} estrelas</Label>
                <div className="flex items-center gap-4">
                  {renderStars(rating, 'lg')}
                  <Slider
                    value={[rating]}
                    onValueChange={(value) => setRating(value[0])}
                    min={1}
                    max={5}
                    step={1}
                    className="flex-1"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="review-content">Comentário (opcional)</Label>
                <Textarea
                  id="review-content"
                  value={reviewContent}
                  onChange={(e) => setReviewContent(e.target.value)}
                  placeholder="Partilha a tua experiência com esta cerveja..."
                  rows={4}
                />
              </div>
              
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Submeter Avaliação
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Reviews */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Avaliações</h2>
        
        {reviews.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Ainda não há avaliações. Sê o primeiro a avaliar!
              </p>
            </CardContent>
          </Card>
        ) : (
          reviews.map((review: any) => (
            review?.user ? (
              <Card key={review.id}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar 
                      className="h-10 w-10 cursor-pointer"
                      onClick={() => onUserClick(review.user.id)}
                    >
                      <AvatarImage src={review.user.avatar || undefined} />
                      <AvatarFallback>{review.user.name?.charAt(0) || '?'}</AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <span 
                            className="font-medium cursor-pointer hover:underline"
                            onClick={() => onUserClick(review.user.id)}
                          >
                            {review.user.name}
                          </span>
                          <span className="text-sm text-muted-foreground ml-2">
                            @{review.user.username}
                          </span>
                        </div>
                        {renderStars(review.rating)}
                      </div>
                      
                      {review.content && (
                        <p className="mt-2">{review.content}</p>
                      )}
                      
                      <div className="flex items-center gap-4 mt-3">
                        <span className="text-xs text-muted-foreground">
                          {new Date(review.createdAt).toLocaleDateString('pt-PT')}
                        </span>
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => onOpenComments(review)}
                        >
                          <MessageSquare className="h-3 w-3 mr-1" />
                          {review._count?.comments || 0}
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 px-2 ${likedReviews.has(review.id) ? 'text-red-500' : ''}`}
                          onClick={() => handleLike(review.id)}
                        >
                          <Heart className={`h-3 w-3 mr-1 ${likedReviews.has(review.id) ? 'fill-current' : ''}`} />
                          {review._count?.likes || 0}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null
          ))
        )}
      </div>
    </div>
  );
}
