import { useState, useEffect } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Message } from '@/types/chat';
import { Quote } from '@/types/source';
import { useCopyIncludeEvidence } from '@/hooks/useCopyIncludeEvidence';

const COPIED_DURATION_MS = 2000;

function stripCitations(content: string): string {
  return content
    .replace(/\s*\[\d+\]\s*/g, ' ')
    .replace(/  +/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1') // remove space before punctuation left after citation removal
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildCopyWithEvidence(content: string, quotes: Quote[]): string {
  let out = content;
  if (quotes.length > 0) {
    const refLines: string[] = ['\n\nReferences:'];
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i];
      const num = i + 1;
      const url = q.pageUrl ?? `https://${q.domain}${q.pagePath}`;
      refLines.push(`[${num}] "${q.snippet}" — ${q.pageTitle} (${url})`);
    }
    out += refLines.join('\n');
  }
  return out;
}

interface CopyMessageButtonProps {
  message: Message;
  className?: string;
}

export const CopyMessageButton = ({ message, className }: CopyMessageButtonProps) => {
  const [justCopied, setJustCopied] = useState(false);
  const { copyIncludeEvidence: includeEvidence, setCopyIncludeEvidence } = useCopyIncludeEvidence();

  useEffect(() => {
    if (!justCopied) return;
    const t = setTimeout(() => setJustCopied(false), COPIED_DURATION_MS);
    return () => clearTimeout(t);
  }, [justCopied]);

  const isUser = message.role === 'user';
  const quotes = message.quotes ?? [];

  const doCopy = () => {
    const withEvidence = isUser ? true : includeEvidence;
    const text = withEvidence && !isUser
      ? buildCopyWithEvidence(message.content, quotes)
      : stripCitations(message.content);
    navigator.clipboard.writeText(text).then(
      () => setJustCopied(true),
      () => {},
    );
  };

  const setMode = (withEvidence: boolean) => setCopyIncludeEvidence(withEvidence);

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
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 px-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0" aria-label="Copy format">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setMode(true)}>
          {includeEvidence ? '✓ ' : ''}Copy with evidence
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode(false)}>
          {!includeEvidence ? '✓ ' : ''}Copy without evidence
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
