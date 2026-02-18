import { useState, useRef, useEffect, KeyboardEvent, useCallback } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type DisableReason = 'no_sources' | 'processing' | 'loading' | 'adding_page' | null;

const SLASH_COMMANDS = [
  { command: '/unfold', label: 'Unfold', description: 'Force min 2 steps for complex questions' },
  { command: '/direct', label: 'Direct', description: 'Single pass only' },
] as const;

function getUnfoldModeFromCommand(command: string): 'unfold' | 'direct' | undefined {
  if (command === '/unfold') return 'unfold';
  if (command === '/direct') return 'direct';
  return undefined;
}

function parseSlashCommand(message: string): { content: string; unfoldMode?: 'unfold' | 'direct' } {
  const trimmed = message.trim();
  for (const { command } of SLASH_COMMANDS) {
    if (trimmed === command || trimmed.startsWith(command + ' ') || trimmed.startsWith(command + '\n')) {
      const content = trimmed.slice(command.length).replace(/^\s+/, '').trim();
      const mode = getUnfoldModeFromCommand(command);
      return { content, unfoldMode: mode };
    }
  }
  return { content: trimmed, unfoldMode: undefined };
}

interface ChatInputProps {
  onSendMessage: (message: string, options?: { unfoldMode?: 'unfold' | 'direct' }) => void;
  isLoading: boolean;
  /** When true, send is disabled */
  isDisabled?: boolean;
  /** Why send is disabled - used for Enter key feedback */
  disableReason?: DisableReason;
  /** Called when user presses Enter with no sources - open add source modal */
  onRequestAddSource?: () => void;
}

export const ChatInput = ({
  onSendMessage,
  isLoading,
  isDisabled = false,
  disableReason = null,
  onRequestAddSource,
}: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasCompleteSlashCommand = !!message.match(/^\/(unfold|direct)\s/);
  const slashFilter = message.startsWith('/')
    ? message.slice(1).split(/\s/)[0] ?? ''
    : '';
  const filteredCommands = SLASH_COMMANDS.filter(
    (c) => c.command.slice(1).toLowerCase().startsWith(slashFilter.toLowerCase())
  );
  const showSlashMenu = message.startsWith('/') && filteredCommands.length > 0 && !hasCompleteSlashCommand;

  useEffect(() => {
    setSlashMenuOpen(showSlashMenu);
    if (showSlashMenu) setSlashSelectedIndex(0);
  }, [showSlashMenu]);

  useEffect(() => {
    if (slashMenuOpen && slashSelectedIndex >= filteredCommands.length) {
      setSlashSelectedIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [slashMenuOpen, slashSelectedIndex, filteredCommands.length]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const applySlashCommand = useCallback(
    (cmd: (typeof SLASH_COMMANDS)[number]) => {
      const rest = message.slice(1 + slashFilter.length).replace(/^\s+/, '');
      setMessage(cmd.command + (rest ? ' ' + rest : ' '));
      setSlashMenuOpen(false);
      textareaRef.current?.focus();
    },
    [message, slashFilter]
  );

  const disabled = isLoading || isDisabled;

  const handleSubmit = () => {
    const { content, unfoldMode } = parseSlashCommand(message);
    if (content && !disabled) {
      onSendMessage(content, unfoldMode ? { unfoldMode } : undefined);
      setMessage('');
    }
  };

  const enterShouldAutocomplete = showSlashMenu && !hasCompleteSlashCommand;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSelectedIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSelectedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredCommands[slashSelectedIndex];
        if (selected) applySlashCommand(selected);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && enterShouldAutocomplete) {
        e.preventDefault();
        const selected = filteredCommands[slashSelectedIndex];
        if (selected) {
          applySlashCommand(selected);
          return;
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (disabled && disableReason === 'no_sources' && onRequestAddSource) {
        onRequestAddSource();
        return;
      }
      if (disabled && (disableReason === 'processing' || disableReason === 'loading' || disableReason === 'adding_page')) {
        toast.info('Wait for processing to finish', { duration: 3000 });
        return;
      }
      handleSubmit();
    }
  };

  return (
    <div ref={containerRef} className="border-t border-border bg-background p-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-center gap-2 bg-secondary rounded-2xl p-2 shadow-soft">
          {showSlashMenu && (
            <div
              className="absolute bottom-full left-2 right-14 mb-1 rounded-lg border border-border bg-popover shadow-lg overflow-hidden z-50"
              role="listbox"
            >
              {filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.command}
                  type="button"
                  role="option"
                  aria-selected={i === slashSelectedIndex}
                  className={cn(
                    'w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors',
                    i === slashSelectedIndex ? 'bg-amber-500/15 text-foreground' : 'hover:bg-muted/50'
                  )}
                  onClick={() => applySlashCommand(cmd)}
                >
                  <span className="font-medium">{cmd.command}</span>
                  <span className="text-xs text-muted-foreground">{cmd.description}</span>
                </button>
              ))}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSlashMenuOpen(false), 150)}
            placeholder="Ask Scholia anything... Type / for commands"
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
      </div>
    </div>
  );
};
