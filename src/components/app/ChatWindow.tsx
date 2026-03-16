'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, Loader2, Send } from 'lucide-react';

interface Message {
  id: string;
  content: string;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    username: string;
    avatar: string | null;
  };
}

interface ChatWindowProps {
  otherUser: {
    id: string;
    name: string;
    username: string;
    avatar: string | null;
  };
  currentUserId: string;
  currentUserName: string;
  onBack: () => void;
}

export function ChatWindow({ otherUser, currentUserId, currentUserName, onBack }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMessages();
    // Poll for new messages every 5 seconds
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [otherUser.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`/api/messages?userId=${otherUser.id}`, { credentials: 'include' });
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    // Check if user is logged in
    if (!currentUserId) {
      setError('You must be logged in to send messages');
      return;
    }

    // Check if user is trying to message themselves
    if (currentUserId === otherUser.id) {
      setError('You cannot send messages to yourself');
      return;
    }

    setIsSending(true);
    setError(null);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiverId: otherUser.id,
          receiverName: otherUser.name,
          content: newMessage.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Failed to send message', { status: res.status, body: err });
        
        if (res.status === 401) {
          setError('Please log in to send messages');
        } else {
          setError(err.error || 'Failed to send message');
        }
        return;
      }

      const data = await res.json();

      // Ensure the message has the correct structure
      if (data?.message && data.message.sender) {
        setMessages(prev => [...prev, data.message]);
        setNewMessage('');

        // Trigger global refresh for notifications / counts
        window.dispatchEvent(new Event('beersocial:refreshNotifications'));
      } else {
        console.error('Invalid message structure received:', data?.message);
        setError('Invalid response from server');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Network error - please try again');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="flex flex-col h-[calc(100vh-200px)]">
      <CardHeader className="flex-shrink-0 border-b">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Avatar>
            <AvatarImage src={otherUser.avatar || undefined} />
            <AvatarFallback>{otherUser.name?.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <CardTitle className="text-lg">{otherUser.name}</CardTitle>
            <p className="text-sm text-muted-foreground">@{otherUser.username}</p>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-center">
              Começa a conversa com {otherUser.name}!
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.sender?.id === currentUserId ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-4 py-2 ${
                  message.sender?.id === currentUserId
                    ? 'bg-amber-500 text-white'
                    : 'bg-muted'
                }`}
              >
                <p>{message.content}</p>
                <p className={`text-xs mt-1 ${
                  message.sender?.id === currentUserId ? 'text-amber-100' : 'text-muted-foreground'
                }`}>
                  {new Date(message.createdAt).toLocaleTimeString('pt-PT', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </CardContent>
      
      {error && (
        <div className="flex-shrink-0 px-4 py-2 bg-red-50 border-t border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      
      <form onSubmit={handleSend} className="flex-shrink-0 p-4 border-t flex gap-2">
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Escreve uma mensagem..."
          disabled={isSending}
        />
        <Button type="submit" size="icon" disabled={!newMessage.trim() || isSending}>
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </Card>
  );
}
