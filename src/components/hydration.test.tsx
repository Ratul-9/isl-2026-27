import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchWorkspace } from './MatchWorkspace';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

describe('MatchWorkspace hydration', () => {
  beforeEach(() => {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prerenders only the loading fallback and hydrates without mismatch warnings', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const html = renderToString(<MatchWorkspace />);
    expect(html).toContain('Loading match');
    expect(html).not.toContain('Tactical board');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    // act() flushes hydration plus the client-only switch to the real workspace.
    await act(async () => {
      hydrateRoot(container, <MatchWorkspace />);
    });

    expect(container.querySelector('[aria-label^="Tactical board"]')).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
    container.remove();
  });
});
