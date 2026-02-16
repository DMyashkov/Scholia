import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  /** When true, send is disabled (e.g. no sources, add-page in progress) */
  isDisabled?: boolean;
}

export const ChatInput = ({ onSendMessage, isLoading, isDisabled = false }: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const disabled = isLoading || isDisabled;
  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message);
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-border bg-background p-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-center gap-2 bg-secondary rounded-2xl p-2 shadow-soft">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Scholia anything..."
            className={cn(
              'flex-1 min-h-[44px] max-h-[200px] resize-none border-0 bg-transparent',
              'text-foreground placeholder:text-muted-foreground',
              'focus-visible:ring-0 focus-visible:ring-offset-0',
              'py-3 px-4 text-sm leading-relaxed scrollbar-thin'
            )}
            rows={1}
          />
          <Button
            onClick={handleSubmit}
            disabled={!message.trim() || disabled}
            size="icon"
            className={cn(
              'shrink-0 h-10 w-10 rounded-xl transition-all',
              message.trim() && !disabled
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-3">
          Scholia uses mock responses. Answers may vary.
        </p>
      </div>
    </div>
  );
};
