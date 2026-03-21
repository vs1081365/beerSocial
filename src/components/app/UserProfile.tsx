'use client';

import React, { useState, useEffect } from 'react';
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
  Star, 
  Edit2, 
  UserPlus, 
  Check, 
  UserCheck,
  MessageCircle,
  Activity,
  Heart,
  MessageSquare,
  Clock,
  Users
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
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [activities, setActivities] = useState<any[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  
  // Edit form
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [favoriteBeer, setFavoriteBeer] = useState('');

  const isOwnProfile = currentUserId === userId;

  useEffect(() => {
    fetchUser();
    fetchActivity();
  }, [userId]);

  const fetchActivity = async () => {
    setIsLoadingActivity(true);
    try {
      const res = await fetch(`/api/cassandra/activity?userId=${userId}&limit=20`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error('Error fetching activity:', error);
    } finally {
      setIsLoadingActivity(false);
    }
  };

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

  const handleFollow = async () => {
    if (!currentUserId) {
      onAuthRequired();
      return;
    }
    setIsFollowLoading(true);
    try {
      const res = await fetch(`/api/users/${userId}/follow`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        fetchUser();
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    } finally {
      setIsFollowLoading(false);
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
    let followIcon: React.ReactNode;
    if (isFollowLoading) {
      followIcon = <Loader2 className="h-4 w-4 animate-spin mr-2" />;
    } else if (user.isFollowing) {
      followIcon = <UserCheck className="h-4 w-4 mr-2" />;
    } else {
      followIcon = <Users className="h-4 w-4 mr-2" />;
    }

    const followBtn = (
      <Button
        variant={user.isFollowing ? 'outline' : 'default'}
        size="sm"
        onClick={handleFollow}
        disabled={isFollowLoading}
      >
        {followIcon}
        {user.isFollowing ? 'A Seguir' : 'Seguir'}
      </Button>
    );

    if (!friendshipStatus) {
      return (
        <div className="flex flex-col gap-2">
          <Button onClick={handleFriendRequest} disabled={isFriendActionLoading}>
            <UserPlus className="h-4 w-4 mr-2" />
            Adicionar Amigo
          </Button>
          {followBtn}
        </div>
      );
    }

    if (friendshipStatus.status === 'PENDING') {
      if (friendshipStatus.isRequester) {
        return (
          <div className="flex flex-col gap-2">
            <Button variant="outline" disabled>Pedido Enviado</Button>
            {followBtn}
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-2">
          <Button onClick={handleAcceptFriend} disabled={isFriendActionLoading}>
            <Check className="h-4 w-4 mr-2" />
            Aceitar
          </Button>
          {followBtn}
        </div>
      );
    }

    if (friendshipStatus.status === 'ACCEPTED') {
      return (
        <div className="flex flex-col gap-2">
          <Button variant="outline" disabled>
            <Check className="h-4 w-4 mr-2" />
            Amigos
          </Button>
          <Button variant="outline" onClick={() => onSendMessage(user)}>
            <MessageCircle className="h-4 w-4 mr-2" />
            Mensagem
          </Button>
          {followBtn}
        </div>
      );
    }

    return null;
  };

  const activityIcon = (type: string) => {
    if (type === 'REVIEW') return <Star className="h-4 w-4 text-amber-500" />;
    if (type === 'COMMENT') return <MessageSquare className="h-4 w-4 text-blue-500" />;
    if (type === 'LIKE') return <Heart className="h-4 w-4 text-rose-500" />;
    return <Activity className="h-4 w-4 text-muted-foreground" />;
  };

  const activityLabel = (a: any) => {
    if (a.type === 'REVIEW') return `Avaliou ${a.beerName} com ${a.rating}★`;
    if (a.type === 'COMMENT') return `Comentou em review de ${a.beerName}`;
    if (a.type === 'LIKE') return `Gostou de uma review de ${a.beerName}`;
    return a.type;
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
                <div className="text-2xl font-bold">{user.followerCount ?? 0}</div>
                <div className="text-sm text-muted-foreground">Seguidores</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{user.followingCount ?? 0}</div>
                <div className="text-sm text-muted-foreground">A seguir</div>
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

      {/* Atividade Recente */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4" />
            <span className="font-medium text-sm">Atividade Recente</span>
          </div>
          {isLoadingActivity ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            </div>
          ) : null}
          {!isLoadingActivity && activities.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>Sem atividade registada ainda.</p>
            </div>
          )}
          {!isLoadingActivity && activities.length > 0 && (
            <ul className="space-y-3">
              {activities.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <div className="mt-0.5">{activityIcon(a.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{activityLabel(a)}</p>
                    {a.content && (
                      <p className="text-xs text-muted-foreground truncate">{a.content}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                    <Clock className="h-3 w-3" />
                    {new Date(a.createdAt).toLocaleDateString('pt-PT')}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground mt-4 text-right">
            Fonte: Cassandra — user_activity (partition key: user_id)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
