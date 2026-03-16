'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/app/Header';
import { BeerCard } from '@/components/app/BeerCard';
import { ReviewCard } from '@/components/app/ReviewCard';
import { BeerDetail } from '@/components/app/BeerDetail';
import { UserProfile } from '@/components/app/UserProfile';
import { ChatWindow } from '@/components/app/ChatWindow';
import { AddBeerForm } from '@/components/app/AddBeerForm';
import { FriendsList } from '@/components/app/FriendsList';
import { CommentSection } from '@/components/app/CommentSection';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Beer, MessageSquare, Loader2, TrendingUp, Clock, Star } from 'lucide-react';

interface User {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  bio?: string | null;
  location?: string | null;
  favoriteBeer?: string | null;
}

interface Beer {
  id: string;
  name: string;
  brewery: string;
  style: string;
  abv: number;
  ibu: number | null;
  image: string | null;
  avgRating: number;
  reviewCount: number;
}

interface Review {
  id: string;
  rating: number;
  content: string | null;
  createdAt: string;
  user: User;
  beer: {
    id: string;
    name: string;
    brewery: string;
    image: string | null;
  };
  _count: {
    comments: number;
    likes: number;
  };
}

type ViewType = 'feed' | 'beer' | 'profile' | 'chat' | 'add-beer' | 'friends' | 'my-reviews' | 'search';

export default function Home() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [view, setView] = useState<ViewType>('feed');
  const [viewData, setViewData] = useState<any>(null);
  const [beers, setBeers] = useState<Beer[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReviewForComments, setSelectedReviewForComments] = useState<Review | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Load data when view changes
  useEffect(() => {
    if (view === 'feed') {
      loadData();
    } else if (view === 'search') {
      searchBeers(searchQuery);
    }
  }, [view]);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
      }
    } catch (error) {
      console.error('Error checking auth:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [beersRes, reviewsRes] = await Promise.all([
        fetch('/api/beers?limit=12'),
        fetch('/api/reviews?limit=10')
      ]);
      
      if (beersRes.ok) {
        const beersData = await beersRes.json();
        setBeers(beersData.beers);
      }
      
      if (reviewsRes.ok) {
        const reviewsData = await reviewsRes.json();
        setReviews(reviewsData.reviews);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const searchBeers = async (query: string) => {
    if (!query.trim()) {
      setView('feed');
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await fetch(`/api/beers?search=${encodeURIComponent(query)}`);
      const data = await res.json();
      setBeers(data.beers);
      setView('search');
    } catch (error) {
      console.error('Error searching beers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = (newView: string, data?: any) => {
    setView(newView as ViewType);
    setViewData(data);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    searchBeers(query);
  };

  const handleAuth = (user: User) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setView('feed');
  };

  const handleOpenComments = (review: Review) => {
    setSelectedReviewForComments(review);
  };

  const handleLikeToggle = (reviewId: string, liked: boolean) => {
    // Update the like count in the review list
    setReviews(prev => prev.map(r => 
      r.id === reviewId 
        ? { ...r, _count: { ...r._count, likes: liked ? r._count.likes + 1 : r._count.likes - 1 } }
        : r
    ));
  };

  const renderContent = () => {
    switch (view) {
      case 'beer':
        return (
          <BeerDetail
            beerId={viewData}
            currentUser={currentUser}
            onBack={() => setView('feed')}
            onUserClick={(userId) => handleNavigate('profile', userId)}
            onOpenComments={handleOpenComments}
            onLoginRequired={() => setShowAuthModal(true)}
          />
        );
      
      case 'profile':
        return (
          <UserProfile
            userId={viewData}
            currentUserId={currentUser?.id || null}
            onBack={() => setView('feed')}
            onSendMessage={(user) => handleNavigate('chat', user)}
            onAuthRequired={() => setShowAuthModal(true)}
          />
        );
      
      case 'chat':
        if (!currentUser) {
          setShowAuthModal(true);
          return null;
        }
        return (
          <ChatWindow
            otherUser={viewData}
            currentUserId={currentUser.id}
            currentUserName={currentUser.name}
            onBack={() => setView('feed')}
          />
        );
      
      case 'add-beer':
        if (!currentUser) {
          setShowAuthModal(true);
          return null;
        }
        return (
          <AddBeerForm
            onBack={() => setView('feed')}
            onSuccess={(beerId) => handleNavigate('beer', beerId)}
          />
        );
      
      case 'friends':
        if (!currentUser) {
          setShowAuthModal(true);
          return null;
        }
        return (
          <FriendsList
            currentUserId={currentUser.id}
            onBack={() => setView('feed')}
            onUserClick={(userId) => handleNavigate('profile', userId)}
            onSendMessage={(user) => handleNavigate('chat', user)}
          />
        );
      
      case 'my-reviews':
        if (!currentUser) {
          setShowAuthModal(true);
          return null;
        }
        return (
          <div className="space-y-6">
            <Button variant="ghost" onClick={() => setView('feed')}>
              ← Voltar
            </Button>
            <h1 className="text-2xl font-bold">As Minhas Reviews</h1>
            <MyReviews 
              userId={currentUser.id}
              onBeerClick={(beerId) => handleNavigate('beer', beerId)}
              onUserClick={(userId) => handleNavigate('profile', userId)}
              onOpenComments={handleOpenComments}
              onLikeToggle={handleLikeToggle}
              currentUser={currentUser}
            />
          </div>
        );
      
      case 'search':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">Resultados para "{searchQuery}"</h1>
              <Button variant="ghost" onClick={() => { setView('feed'); loadData(); }}>
                Limpar pesquisa
              </Button>
            </div>
            {renderBeersGrid()}
          </div>
        );
      
      default:
        return (
          <Tabs defaultValue="discover" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="discover" className="flex items-center gap-2">
                <Beer className="h-4 w-4" />
                Descobrir Cervejas
              </TabsTrigger>
              <TabsTrigger value="feed" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Feed de Reviews
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="discover">
              {renderBeersGrid()}
            </TabsContent>
            
            <TabsContent value="feed">
              {renderReviewsFeed()}
            </TabsContent>
          </Tabs>
        );
    }
  };

  const renderBeersGrid = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        </div>
      );
    }

    if (beers.length === 0) {
      return (
        <Card>
          <CardContent className="py-12 text-center">
            <Beer className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Nenhuma cerveja encontrada. Sê o primeiro a adicionar!
            </p>
            {currentUser && (
              <Button 
                className="mt-4" 
                onClick={() => handleNavigate('add-beer', null)}
              >
                Adicionar Cerveja
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {beers.map((beer) => (
          <BeerCard
            key={beer.id}
            beer={beer}
            onClick={() => handleNavigate('beer', beer.id)}
          />
        ))}
      </div>
    );
  };

  const renderReviewsFeed = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        </div>
      );
    }

    if (reviews.length === 0) {
      return (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Ainda não há reviews. Avalia uma cerveja para começar!
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {reviews.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            currentUser={currentUser}
            onUserClick={(userId) => handleNavigate('profile', userId)}
            onBeerClick={(beerId) => handleNavigate('beer', beerId)}
            onCommentsClick={handleOpenComments}
            onLikeToggle={handleLikeToggle}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        currentUser={currentUser}
        onAuth={handleAuth}
        onLogout={handleLogout}
        onSearch={handleSearch}
        onNavigate={handleNavigate}
      />
      
      <main className="container py-6 px-4">
        {renderContent()}
      </main>

      {/* Comments Dialog */}
      <Dialog 
        open={!!selectedReviewForComments} 
        onOpenChange={() => setSelectedReviewForComments(null)}
      >
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Comentários</DialogTitle>
          </DialogHeader>
          {selectedReviewForComments && (
            <CommentSection
              reviewId={selectedReviewForComments.id}
              currentUser={currentUser}
              onUserClick={(userId) => {
                setSelectedReviewForComments(null);
                handleNavigate('profile', userId);
              }}
              onClose={() => setSelectedReviewForComments(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Auth Modal */}
      {!currentUser && (
        <Button
          className="fixed bottom-4 right-4 shadow-lg"
          onClick={() => setShowAuthModal(true)}
        >
          Entrar / Registar
        </Button>
      )}
    </div>
  );
}

// My Reviews Component
function MyReviews({ 
  userId, 
  onBeerClick, 
  onUserClick, 
  onOpenComments,
  onLikeToggle,
  currentUser
}: { 
  userId: string;
  onBeerClick: (id: string) => void;
  onUserClick: (id: string) => void;
  onOpenComments: (review: any) => void;
  onLikeToggle: (reviewId: string, liked: boolean) => void;
  currentUser: User | null;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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
    
    fetchReviews();
  }, [userId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            Ainda não fizeste nenhuma review. Explora cervejas e partilha as tuas opiniões!
          </p>
        </CardContent>
      </Card>
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
