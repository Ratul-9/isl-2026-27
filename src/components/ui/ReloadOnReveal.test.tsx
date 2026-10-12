import { Activity, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ReloadOnReveal } from './ReloadOnReveal';

/** Stands in for the match library / workspace: reads "storage" once, on mount. */
function Snapshot({ source }: { source: { value: string } }) {
  const [snapshot] = useState(() => source.value);
  const [draft, setDraft] = useState('');
  return (
    <div>
      <p data-testid="snapshot">{snapshot}</p>
      <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
    </div>
  );
}

function Host({ mode, source, guarded }: { mode: 'visible' | 'hidden'; source: { value: string }; guarded: boolean }) {
  const content = <Snapshot source={source} />;
  return <Activity mode={mode}>{guarded ? <ReloadOnReveal>{content}</ReloadOnReveal> : content}</Activity>;
}

describe('ReloadOnReveal', () => {
  it('without it, a hidden route comes back with stale state (the bug)', () => {
    const source = { value: 'v1' };
    const { rerender } = render(<Host mode="visible" source={source} guarded={false} />);
    expect(screen.getByTestId('snapshot')).toHaveTextContent('v1');
    rerender(<Host mode="hidden" source={source} guarded={false} />);
    source.value = 'v2'; // e.g. renamed from the library while hidden
    rerender(<Host mode="visible" source={source} guarded={false} />);
    expect(screen.getByTestId('snapshot')).toHaveTextContent('v1');
  });

  it('re-reads data when the route is shown again', () => {
    const source = { value: 'v1' };
    const { rerender } = render(<Host mode="visible" source={source} guarded />);
    expect(screen.getByTestId('snapshot')).toHaveTextContent('v1');
    rerender(<Host mode="hidden" source={source} guarded />);
    source.value = 'v2';
    rerender(<Host mode="visible" source={source} guarded />);
    expect(screen.getByTestId('snapshot')).toHaveTextContent('v2');
  });

  it('does not reload while it just stays visible, and keeps local state', async () => {
    const source = { value: 'v1' };
    const user = userEvent.setup();
    const { rerender } = render(<Host mode="visible" source={source} guarded />);
    await user.type(screen.getByLabelText('draft'), 'abc');
    source.value = 'v2';
    rerender(<Host mode="visible" source={source} guarded />);
    expect(screen.getByTestId('snapshot')).toHaveTextContent('v1');
    expect(screen.getByLabelText('draft')).toHaveValue('abc');
  });

  it('resets transient UI state on reveal', async () => {
    const source = { value: 'v1' };
    const user = userEvent.setup();
    const { rerender } = render(<Host mode="visible" source={source} guarded />);
    await user.type(screen.getByLabelText('draft'), 'half-typed');
    rerender(<Host mode="hidden" source={source} guarded />);
    rerender(<Host mode="visible" source={source} guarded />);
    expect(screen.getByLabelText('draft')).toHaveValue('');
  });
});
