import { useState, useEffect } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Message, ThoughtProcess } from '@/types/chat';
import { useCopyFormat } from '@/hooks/useCopyFormat';
import { buildMessageCopyText, type CopyFormat } from '@/lib/copyMessageText';

const COPIED_DURATION_MS = 2000;

interface CopyMessageButtonProps {
  message: Message;
  className?: string;
  phases?: ThoughtProcess[];
}

export const CopyMessageButton = ({ message, className, phases }: CopyMessageButtonProps) => {
  const [justCopied, setJustCopied] = useState(false);
  const { copyFormat, setCopyFormat } = useCopyFormat();

  useEffect(() => {
    if (!justCopied) return;
    const t = setTimeout(() => setJustCopied(false), COPIED_DURATION_MS);
    return () => clearTimeout(t);
  }, [justCopied]);

  const isUser = message.role === 'user';

  const doCopy = () => {
    const format: CopyFormat = isUser ? 'plain' : copyFormat;
    const text = buildMessageCopyText(message, format, phases);
    navigator.clipboard.writeText(text).then(
      () => setJustCopied(true),
      () => {},
    );
  };

  if (isUser) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={className}
        onClick={doCopy}
        aria-label="Copy"
      >
        {justCopied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <div className="flex items-center rounded-md border border-input bg-background">
        <Button
          variant="ghost"
          size="icon"
          className={className}
          onClick={doCopy}
          aria-label="Copy"
        >
          {justCopied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </Button>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 px-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            aria-label="Copy format"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setCopyFormat('evidence')}>
          {copyFormat === 'evidence' ? '✓ ' : ''}Copy with evidence
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setCopyFormat('plain')}>
          {copyFormat === 'plain' ? '✓ ' : ''}Copy without evidence
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setCopyFormat('debug')}>
          {copyFormat === 'debug' ? '✓ ' : ''}Copy with evidence + thinking
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
