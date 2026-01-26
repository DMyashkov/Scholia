/**
 * Component wrapper to load source data using hooks
 * This allows us to use hooks for each source without violating hook rules
 */

import { useSourceWithData } from '@/hooks/useSourceWithData';
import type { Source as DBSource } from '@/lib/db/types';
import type { Source } from '@/types/source';

interface SourceWithDataProps {
  dbSource: DBSource;
  children: (source: Source) => React.ReactNode;
}

export function SourceWithData({ dbSource, children }: SourceWithDataProps) {
  const source = useSourceWithData(dbSource);
  if (!source) return null;
  return <>{children(source)}</>;
}
