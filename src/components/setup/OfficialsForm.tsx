'use client';

import { OFFICIAL_FIELDS } from '@/domain/match';
import { useMatch, useMatchActions } from '@/store/MatchContext';
import { TextField } from '@/components/ui/fields';
import { Section } from '@/components/ui/Section';

export function OfficialsForm() {
  const { officials } = useMatch();
  const { updateOfficials } = useMatchActions();

  return (
    <Section title="Match officials" description="Full names of the four match officials.">
      <div className="grid gap-4 sm:grid-cols-2">
        {OFFICIAL_FIELDS.map(({ key, label }) => (
          <TextField
            key={key}
            label={label}
            value={officials[key]}
            onChange={(e) => updateOfficials({ [key]: e.target.value })}
            maxLength={80}
            autoComplete="off"
          />
        ))}
      </div>
    </Section>
  );
}
