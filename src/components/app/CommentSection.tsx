'use client';

import { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Heart, Loader2, Send } from 'lucide-react';

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    username: string;
    avatar: string | null;
  };
  _count?: {
    likes: number;
  };
}

interface CommentSectionProps {
  reviewId: string;
  currentUser: { id: string } | null;
  onUserClick: (userId: string) => void;
  onClose: () => void;
}

export function CommentSection({ reviewId, currentUser, onUserClick, onClose }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchComments();
  }, [reviewId]);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/comments?reviewId=${reviewId}`);
      const data = await res.json();
      setComments(data.comments);
      
      // Check which comments are liked by current user
      if (currentUser) {
        const liked = new Set<string>();
        for (const comment of data.comments) {
          const likeRes = await fetch(`/api/likes?commentId=${comment.id}`);
          const likeData = await likeRes.json();
          if (likeData.liked) liked.add(comment.id);
        }
        setLikedComments(liked);
      }
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !currentUser) return;

    setIsSending(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId,
          content: newComment.trim()
        })
      });
      const data = await res.json();
      setComments(prev => [...prev, data.comment]);
      setNewComment('');
    } catch (error) {
      console.error('Error posting comment:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!currentUser) return;
    
    try {
      const res = await fetch('/api/likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId })
      });
      const data = await res.json();
      
      setLikedComments(prev => {
        const newSet = new Set(prev);
        if (data.liked) {
          newSet.add(commentId);
        } else {
          newSet.delete(commentId);
        }
        return newSet;
      });
    } catch (error) {
      console.error('Error liking comment:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[60vh]">
      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {comments.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">
            Sem comentários ainda. Sê o primeiro a comentar!
          </p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <Avatar 
                className="h-8 w-8 cursor-pointer"
                onClick={() => onUserClick(comment.user.id)}
              >
                <AvatarImage src={comment.user.avatar || undefined} />
                <AvatarFallback>{comment.user.name?.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span 
                    className="font-medium text-sm cursor-pointer hover:underline"
                    onClick={() => onUserClick(comment.user.id)}
                  >
                    {comment.user.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    @{comment.user.username}
                  </span>
                </div>
                <p className="text-sm mt-1">{comment.content}</p>
                <div className="flex items-center gap-4 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {new Date(comment.createdAt).toLocaleDateString('pt-PT')}
                  </span>
                  <button
                    className={`text-xs flex items-center gap-1 ${likedComments.has(comment.id) ? 'text-red-500' : 'text-muted-foreground'}`}
                    onClick={() => handleLikeComment(comment.id)}
                  >
                    <Heart className={`h-3 w-3 ${likedComments.has(comment.id) ? 'fill-current' : ''}`} />
                    Gostar
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      
      {currentUser && (
        <form onSubmit={handleSubmit} className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Escreve um comentário..."
              disabled={isSending}
            />
            <Button type="submit" size="icon" disabled={!newComment.trim() || isSending}>
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
