'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Search, Users, UserPlus, Loader2, MessageCircle } from 'lucide-react';

interface User {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  bio?: string;
}

interface FriendsListProps {
  currentUserId: string;
  onBack: () => void;
  onUserClick: (userId: string) => void;
  onSendMessage: (user: User) => void;
}

export function FriendsList({ currentUserId, onBack, onUserClick, onSendMessage }: FriendsListProps) {
  const [friends, setFriends] = useState<User[]>([]);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchFriends();

    // Refresh when a notification arrives (e.g. new friend request via SSE)
    const onRefresh = () => fetchFriends();
    window.addEventListener('beersocial:refreshNotifications', onRefresh);
    return () => window.removeEventListener('beersocial:refreshNotifications', onRefresh);
  }, []);

  const fetchFriends = async () => {
    try {
    const res = await fetch('/api/friends', { credentials: 'include' });
      const data = await res.json();
      setFriends(data.friends || []);
      setPendingRequests(data.pendingRequests || []);
    } catch (error) {
      console.error('Error fetching friends:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/users?search=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults((data.users || []).filter((u: User) => u.id !== currentUserId));
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSendRequest = async (userId: string, userName: string) => {
    setRequestErrors(prev => ({ ...prev, [userId]: '' }));
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresseeId: userId, addresseeName: userName })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as Record<string, string>));
        const msg = body?.error || `Erro ${res.status}`;
        setRequestErrors(prev => ({ ...prev, [userId]: msg }));
        return;
      }

      setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, requestSent: true } as any : u));
    } catch (error) {
      console.error('Error sending friend request:', error);
      setRequestErrors(prev => ({ ...prev, [userId]: 'Erro de rede' }));
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Voltar
      </Button>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Pedidos de Amizade ({pendingRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
                <Avatar 
                  className="cursor-pointer"
                  onClick={() => onUserClick(req.requester.id)}
                >
                  <AvatarImage src={req.requester.avatar || undefined} />
                  <AvatarFallback>{req.requester.name?.charAt(0)}</AvatarFallback>
                </Avatar>
                <div 
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => onUserClick(req.requester.id)}
                >
                  <p className="font-medium truncate">{req.requester.name}</p>
                  <p className="text-sm text-muted-foreground">@{req.requester.username}</p>
                </div>
                <Button 
                  size="sm" 
                  onClick={() => {
                    fetch('/api/friends', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ friendshipId: req.id, action: 'accept' })
                    }).then(fetchFriends);
                  }}
                >
                  Aceitar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Search for friends */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Procurar Amigos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar por nome ou username..."
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          
          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {searchResults.map((user) => (
                <div key={user.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
                  <Avatar 
                    className="cursor-pointer"
                    onClick={() => onUserClick(user.id)}
                  >
                    <AvatarImage src={user.avatar || undefined} />
                    <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div 
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => onUserClick(user.id)}
                  >
                    <p className="font-medium truncate">{user.name}</p>
                    <p className="text-sm text-muted-foreground">@{user.username}</p>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => handleSendRequest(user.id, user.name)}
                    disabled={(user as any).requestSent}
                  >
                    {(user as any).requestSent ? 'Enviado' : 'Adicionar'}
                  </Button>
                  {requestErrors[user.id] && (
                    <p className="text-xs text-red-500 mt-1">{requestErrors[user.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Friends List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Os Teus Amigos ({friends.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : friends.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Ainda não tens amigos. Procura e adiciona novos amigos!
            </p>
          ) : (
            <div className="space-y-2">
              {friends.map((friend) => (
                <div key={friend.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
                  <Avatar 
                    className="cursor-pointer"
                    onClick={() => onUserClick(friend.id)}
                  >
                    <AvatarImage src={friend.avatar || undefined} />
                    <AvatarFallback>{friend.name?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div 
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => onUserClick(friend.id)}
                  >
                    <p className="font-medium truncate">{friend.name}</p>
                    <p className="text-sm text-muted-foreground">@{friend.username}</p>
                  </div>
                  <Button 
                    size="icon" 
                    variant="ghost"
                    onClick={() => onSendMessage(friend)}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
