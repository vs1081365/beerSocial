'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  ArrowLeft, 
  Loader2, 
  MapPin, 
  Beer, 
  Users, 
  Star, 
  Edit2, 
  UserPlus, 
  Check, 
  X,
  MessageCircle
} from 'lucide-react';

interface UserProfileProps {
  userId: string;
  currentUserId: string | null;
  onBack: () => void;
  onSendMessage: (user: any) => void;
  onAuthRequired: () => void;
}

export function UserProfile({ 
  userId, 
  currentUserId, 
  onBack,
  onSendMessage,
  onAuthRequired
}: UserProfileProps) {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFriendActionLoading, setIsFriendActionLoading] = useState(false);
  
  // Edit form
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [favoriteBeer, setFavoriteBeer] = useState('');

  const isOwnProfile = currentUserId === userId;

  useEffect(() => {
    fetchUser();
  }, [userId]);

  const fetchUser = async () => {
    try {
      const res = await fetch(`/api/users/${userId}`, { credentials: 'include' });
      const data = await res.json();
      setUser(data.user);
      setName(data.user.name);
      setBio(data.user.bio || '');
      setLocation(data.user.location || '');
      setFavoriteBeer(data.user.favoriteBeer || '');
    } catch (error) {
      console.error('Error fetching user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!isOwnProfile) return;
    
    setIsSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio, location, favoriteBeer })
      });
      const data = await res.json();
      setUser(data.user);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving profile:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFriendRequest = async () => {
    if (!currentUserId) {
      onAuthRequired();
      return;
    }

    setIsFriendActionLoading(true);
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresseeId: userId })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        console.error('Error sending friend request', { status: res.status, body });
        return;
      }

      fetchUser();
    } catch (error) {
      console.error('Error sending friend request:', error);
    } finally {
      setIsFriendActionLoading(false);
    }
  };

  const handleAcceptFriend = async () => {
    setIsFriendActionLoading(true);
    try {
      const res = await fetch('/api/friends', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          friendshipId: user.friendshipStatus.friendshipId, 
          action: 'accept' 
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        console.error('Error accepting friend request', { status: res.status, body });
        return;
      }

      fetchUser();
    } catch (error) {
      console.error('Error accepting friend:', error);
    } finally {
      setIsFriendActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Utilizador não encontrado</p>
        <Button onClick={onBack} className="mt-4">Voltar</Button>
      </div>
    );
  }

  const renderFriendButton = () => {
    if (isOwnProfile) return null;

    const { friendshipStatus } = user;

    if (!friendshipStatus) {
      return (
        <Button onClick={handleFriendRequest} disabled={isFriendActionLoading}>
          <UserPlus className="h-4 w-4 mr-2" />
          Adicionar Amigo
        </Button>
      );
    }

    if (friendshipStatus.status === 'PENDING') {
      if (friendshipStatus.isRequester) {
        return (
          <Button variant="outline" disabled>
            Pedido Enviado
          </Button>
        );
      } else {
        return (
          <div className="flex gap-2">
            <Button onClick={handleAcceptFriend} disabled={isFriendActionLoading}>
              <Check className="h-4 w-4 mr-2" />
              Aceitar
            </Button>
          </div>
        );
      }
    }

    if (friendshipStatus.status === 'ACCEPTED') {
      return (
        <div className="flex gap-2">
          <Button variant="outline" disabled>
            <Check className="h-4 w-4 mr-2" />
            Amigos
          </Button>
          <Button variant="outline" onClick={() => onSendMessage(user)}>
            <MessageCircle className="h-4 w-4 mr-2" />
            Mensagem
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Voltar
      </Button>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-6">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-4">
              <Avatar className="h-24 w-24">
                <AvatarImage src={user.avatar || undefined} />
                <AvatarFallback className="text-2xl">{user.name?.charAt(0)}</AvatarFallback>
              </Avatar>
              {isOwnProfile && !isEditing && (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Editar Perfil
                </Button>
              )}
              {!isOwnProfile && renderFriendButton()}
            </div>

            {/* Info */}
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-name">Nome</Label>
                    <Input
                      id="edit-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-bio">Bio</Label>
                    <Textarea
                      id="edit-bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Conta-nos sobre ti..."
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-location">Localização</Label>
                    <Input
                      id="edit-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Onde vives?"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-favorite-beer">Cerveja Favorita</Label>
                    <Input
                      id="edit-favorite-beer"
                      value={favoriteBeer}
                      onChange={(e) => setFavoriteBeer(e.target.value)}
                      placeholder="Qual é a tua cerveja favorita?"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleSaveProfile} disabled={isSaving}>
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Guardar
                    </Button>
                    <Button variant="outline" onClick={() => setIsEditing(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-bold">{user.name}</h1>
                  <p className="text-muted-foreground">@{user.username}</p>
                  
                  {user.bio && (
                    <p className="mt-3">{user.bio}</p>
                  )}
                  
                  <div className="flex flex-wrap gap-3 mt-3">
                    {user.location && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        {user.location}
                      </div>
                    )}
                    {user.favoriteBeer && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Beer className="h-4 w-4" />
                        {user.favoriteBeer}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Stats */}
            <div className="flex flex-row md:flex-col gap-4 md:gap-2 md:text-right">
              <div>
                <div className="text-2xl font-bold">{user.reviewsCount}</div>
                <div className="text-sm text-muted-foreground">Reviews</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{user.friendsCount}</div>
                <div className="text-sm text-muted-foreground">Amigos</div>
              </div>
              {user.avgRating > 0 && (
                <div>
                  <div className="flex items-center gap-1 justify-end">
                    <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                    <span className="text-2xl font-bold">{user.avgRating.toFixed(1)}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">Média</div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
