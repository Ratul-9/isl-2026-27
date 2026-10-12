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

describe('AppProviders hydration', () => {
  it('renders only a static message on the server and never touches browser storage', async () => {
    const { AppProviders } = await import('./AppProviders');
    const storageRead = vi.spyOn(Storage.prototype, 'getItem');
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

    const child = <p>library goes here</p>;
    const html = renderToString(<AppProviders>{child}</AppProviders>);
    expect(html).toContain('Loading DizPitch');
    expect(html).not.toContain('library goes here');
    expect(storageRead).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <AppProviders>{child}</AppProviders>);
    });
    expect(container.textContent).toContain('library goes here');
    expect(errors).not.toHaveBeenCalled();
    container.remove();
  });
});
