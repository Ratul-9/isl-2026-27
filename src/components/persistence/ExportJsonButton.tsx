'use client';

import { Download } from 'lucide-react';
import { exportFileName, serializeDocument } from '@/persistence/document';
import { downloadText } from '@/lib/download';
import { Button } from '@/components/ui/Button';
import type { Match } from '@/domain/types';

/** Downloads the whole match (setup, squads, board, events, clock) as a JSON file. */
export function ExportJsonButton({ match, className }: { match: Match; className?: string }) {
  return (
    <Button
      size="sm"
      className={className}
      title="Download the full match as a JSON file"
      onClick={() => {
        const now = new Date();
        downloadText(serializeDocument(match, now), exportFileName(match, 'json', now));
      }}
    >
      <Download size={14} aria-hidden /> <span className="hidden xl:inline">Export JSON</span>
      <span className="sr-only xl:hidden">Export JSON</span>
    </Button>
  );
}
