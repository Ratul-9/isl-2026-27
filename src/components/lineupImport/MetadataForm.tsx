'use client';

import type { MatchMetadata } from '@/domain/lineupImport/types';
import { TextField } from '@/components/ui/fields';
import { Section } from '@/components/ui/Section';

export function MetadataForm({ value, onChange }: { value: MatchMetadata; onChange: (next: MatchMetadata) => void }) {
  const set = (key: keyof MatchMetadata) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  return (
    <Section title="Match details" description="Not read from the images. Everything here is optional and can be filled in later.">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Competition or tournament" value={value.competition} onChange={set('competition')} maxLength={80} />
        <TextField label="Venue or stadium" value={value.venue} onChange={set('venue')} maxLength={80} />
        <TextField label="Match date" type="date" value={value.date} onChange={set('date')} />
        <TextField label="Kickoff time" type="time" value={value.kickoffTime} onChange={set('kickoffTime')} />
        <TextField label="Referee" value={value.referee} onChange={set('referee')} maxLength={80} />
        <TextField label="Assistant Referee 1" value={value.assistant1} onChange={set('assistant1')} maxLength={80} />
        <TextField label="Assistant Referee 2" value={value.assistant2} onChange={set('assistant2')} maxLength={80} />
        <TextField label="Fourth Official" value={value.fourthOfficial} onChange={set('fourthOfficial')} maxLength={80} />
      </div>
    </Section>
  );
}
