'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Beer, Bell, MessageCircle, Search, Users, LogOut, User, Beer as BeerIcon, Plus, Loader2, Check, X, UserPlus } from 'lucide-react';
import { AuthModal } from './AuthModal';

interface User {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  data: string | null;
}

interface FriendRequest {
  id: string;
  requester: User;
}

interface Conversation {
  user: User;
  lastMessage: {
    content: string;
    createdAt: string;
  };
}

interface HeaderProps {
  currentUser: User | null;
  onAuth: (user: User) => void;
  onLogout: () => void;
  onSearch: (query: string) => void;
  onNavigate: (view: string, data?: any) => void;
}

export function Header({ currentUser, onAuth, onLogout, onSearch, onNavigate }: HeaderProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMessages, setShowMessages] = useState(false);

  useEffect(() => {
    if (!currentUser) return;

    // Initial load
    fetchData();

    // Real-time updates via Server-Sent Events (Redis Pub/Sub)
    const source = new EventSource('/api/realtime');
    source.addEventListener('notification', (e: MessageEvent) => {
      fetchData();
      // Notify page components listening for updates
      window.dispatchEvent(new Event('beersocial:refreshNotifications'));
      // If it's a new review, also refresh the feed
      try {
        const payload = JSON.parse(e.data || '{}');
        if (payload.type === 'NEW_REVIEW') {
          window.dispatchEvent(new Event('beersocial:refreshFeed'));
        }
      } catch { /* non-JSON ping, ignore */ }
    });
    source.addEventListener('message', () => fetchData());
    // Global events (new beers, leaderboard updates)
    source.addEventListener('global', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data || '{}');
        if (payload.type === 'NEW_BEER') {
          window.dispatchEvent(new Event('beersocial:refreshFeed'));
        }
      } catch { /* ignore */ }
    });

    // Also refresh when other parts of the app dispatch an update event
    const onRefresh = () => fetchData();
    window.addEventListener('beersocial:refreshNotifications', onRefresh);

    return () => {
      source.close();
      window.removeEventListener('beersocial:refreshNotifications', onRefresh);
    };
  }, [currentUser]);

  const fetchData = async () => {
    try {
      const [notifRes, friendsRes, msgRes] = await Promise.all([
        fetch('/api/notifications'),
        fetch('/api/friends'),
        fetch('/api/messages')
      ]);

      if (notifRes.ok) {
        const notifData = await notifRes.json();
        setNotifications(notifData.notifications || []);
        setUnreadNotifications(notifData.unreadCount || 0);
      }

      if (friendsRes.ok) {
        const friendsData = await friendsRes.json();
        setFriendRequests(friendsData.pendingRequests || []);
      }

      if (msgRes.ok) {
        const msgData = await msgRes.json();
        setConversations(msgData.conversations || []);
        setUnreadMessages(msgData.unreadCount || 0);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    onLogout();
  };

  const handleAcceptFriend = async (friendshipId: string) => {
    setIsLoading(true);
    try {
      await fetch('/api/friends', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId, action: 'accept' })
      });
      fetchData();
    } finally {
      setIsLoading(false);
    }
  };

  const handleRejectFriend = async (friendshipId: string) => {
    setIsLoading(true);
    try {
      await fetch('/api/friends', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId, action: 'reject' })
      });
      fetchData();
    } finally {
      setIsLoading(false);
    }
  };

  const markNotificationsRead = async () => {
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true })
    });
    setUnreadNotifications(0);
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'FRIEND_REQUEST': return <UserPlus className="h-4 w-4" />;
      case 'FRIEND_ACCEPTED': return <Check className="h-4 w-4" />;
      case 'BEER_REVIEW': return <Beer className="h-4 w-4" />;
      case 'NEW_REVIEW': return <Beer className="h-4 w-4" />;
      case 'NEW_COMMENT': return <MessageCircle className="h-4 w-4" />;
      case 'NEW_LIKE': return <span>❤️</span>;
      case 'NEW_MESSAGE': return <MessageCircle className="h-4 w-4" />;
      default: return <Bell className="h-4 w-4" />;
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <div 
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => onNavigate('feed')}
        >
          <Beer className="h-8 w-8 text-amber-500" />
          <span className="text-xl font-bold">BeerSocial</span>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="hidden md:flex flex-1 max-w-md mx-4">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Pesquisar cervejas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </form>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {currentUser ? (
            <>
              {/* Add Beer Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onNavigate('add-beer')}
                title="Adicionar Cerveja"
              >
                <Plus className="h-5 w-5" />
              </Button>

              {/* Friends */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <Users className="h-5 w-5" />
                    {friendRequests.length > 0 && (
                      <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                        {friendRequests.length}
                      </Badge>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Amigos</SheetTitle>
                    <SheetDescription>
                      Os teus pedidos de amizade e amigos
                    </SheetDescription>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(100vh-120px)] mt-4">
                    <div className="space-y-4">
                      {friendRequests.length > 0 && (
                        <div className="mb-6">
                          <h3 className="font-semibold mb-2">Pedidos Pendentes</h3>
                          {(friendRequests || []).filter(req => req?.requester).map((req, index) => (
                            <div key={req.id || `friend-request-${index}`} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted">
                              <Avatar>
                                <AvatarImage src={req.requester?.avatar || undefined} />
                                <AvatarFallback>{req.requester?.name?.charAt(0) || '?'}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{req.requester?.name || 'Usuário desconhecido'}</p>
                                <p className="text-sm text-muted-foreground">@{req.requester?.username || ''}</p>
                              </div>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={() => handleAcceptFriend(req.id)}>
                                  <Check className="h-4 w-4 text-green-500" />
                                </Button>
                                <Button size="icon" variant="ghost" onClick={() => handleRejectFriend(req.id)}>
                                  <X className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <Button 
                        className="w-full" 
                        onClick={() => onNavigate('friends')}
                      >
                        Ver Todos os Amigos
                      </Button>
                    </div>
                  </ScrollArea>
                </SheetContent>
              </Sheet>

              {/* Messages */}
              <Sheet open={showMessages} onOpenChange={setShowMessages}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <MessageCircle className="h-5 w-5" />
                    {unreadMessages > 0 && (
                      <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                        {unreadMessages}
                      </Badge>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Mensagens</SheetTitle>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(100vh-120px)] mt-4">
                    {conversations.length === 0 ? (
                      <p className="text-muted-foreground text-center py-4">
                        Sem conversas ainda
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(conversations || []).filter(conv => conv?.user).map((conv, index) => (
                          <div
                            key={conv.user?.id || `conversation-${index}`}
                            className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
                            onClick={() => {
                              setShowMessages(false);
                              onNavigate('chat', conv.user);
                            }}
                          >
                            <Avatar>
                              <AvatarImage src={conv.user.avatar || undefined} />
                              <AvatarFallback>{conv.user.name?.charAt(0) || '?'}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{conv.user.name}</p>
                              <p className="text-sm text-muted-foreground truncate">
                                {conv.lastMessage?.content}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </SheetContent>
              </Sheet>

              {/* Notifications */}
              <Sheet open={showNotifications} onOpenChange={(open) => {
                setShowNotifications(open);
                if (open) markNotificationsRead();
              }}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5" />
                    {unreadNotifications > 0 && (
                      <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                        {unreadNotifications}
                      </Badge>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Notificações</SheetTitle>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(100vh-120px)] mt-4">
                    {notifications.length === 0 ? (
                      <p className="text-muted-foreground text-center py-4">
                        Sem notificações
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(notifications || []).map((notif, index) => (
                          <div
                            key={notif.id || `notification-${index}`}
                            className={`flex items-start gap-2 p-2 rounded-lg hover:bg-muted ${!notif.isRead ? 'bg-amber-50' : ''}`}
                          >
                            <div className="mt-1">{getNotificationIcon(notif.type)}</div>
                            <div className="flex-1">
                              <p className="font-medium text-sm">{notif.title}</p>
                              <p className="text-sm text-muted-foreground">{notif.message}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {new Date(notif.createdAt).toLocaleDateString('pt-PT')}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </SheetContent>
              </Sheet>

              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={currentUser.avatar || undefined} />
                      <AvatarFallback>{currentUser.name?.charAt(0)}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>
                    <div>
                      <p>{currentUser.name}</p>
                      <p className="text-sm font-normal text-muted-foreground">@{currentUser.username}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onNavigate('profile', currentUser.id)}>
                    <User className="mr-2 h-4 w-4" />
                    Meu Perfil
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onNavigate('my-reviews')}>
                    <Beer className="mr-2 h-4 w-4" />
                    Minhas Reviews
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-500">
                    <LogOut className="mr-2 h-4 w-4" />
                    Terminar Sessão
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button onClick={() => setShowAuthModal(true)}>
              Entrar
            </Button>
          )}
        </div>
      </div>

      {/* Mobile Search */}
      <div className="md:hidden px-4 pb-2">
        <form onSubmit={handleSearch}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Pesquisar cervejas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </form>
      </div>

      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuth={(user) => {
          onAuth(user);
          setShowAuthModal(false);
        }}
      />
    </header>
  );
}
