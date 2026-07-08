// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import DocumentationModal from '../../../src/components/DocumentationModal';
import useStore from '../../../src/store';

function installElectronApiMock() {
  const electronAPI = {
    openExternalUrl: vi.fn().mockResolvedValue(true),
  };
  Object.assign(window, { electronAPI });
  return electronAPI;
}

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => ReturnType<typeof useStore.getState>;
  };
}

describe('DocumentationModal behavior', () => {
  beforeEach(() => {
    installElectronApiMock();
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows the quick-start page first with task-oriented guidance', () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    expect(screen.getByRole('heading', { name: 'Documentation' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: /search documentation/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Quick Start' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /i want to\.\.\./i })).toBeTruthy();
    expect(screen.getByText(/Open a folder, review decisions, then run delete only when the delete list looks final\./i)).toBeTruthy();
    expect(screen.getByText(/Understand duplicate matches before I rerun them/i)).toBeTruthy();
  });

  test('filters pages from search and resets article scroll when the page changes', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });

    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    await userEvent.type(screen.getByRole('searchbox', { name: /search documentation/i }), 'duplicate');

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    expect(within(docsNav).getByRole('button', { name: /Duplicate Review/i })).toBeTruthy();
    expect(within(docsNav).queryByRole('button', { name: /Delete and Safety/i })).toBeNull();

    await userEvent.clear(screen.getByRole('searchbox', { name: /search documentation/i }));
    await userEvent.click(within(docsNav).getByRole('button', { name: /Review Mode/i }));

    expect(scrollTo).toHaveBeenCalled();
    expect(screen.getByRole('navigation', { name: /on this page/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Current shortcuts' })).toBeTruthy();
  });

  test('renders live shortcut values and page-specific in-app actions', async () => {
    useStore.setState((state) => ({
      settings: {
        ...state.settings,
        keyKeep: { key: 'q', ctrl: false, shift: false, alt: false },
      },
    }));

    const onOpenSettings = vi.fn();
    const onOpenShortcutsHelp = vi.fn();
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={onOpenSettings}
        onOpenShortcutsHelp={onOpenShortcutsHelp}
      />
    );

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    await userEvent.click(within(docsNav).getByRole('button', { name: /Review Mode/i }));

    expect(screen.getByText(/Keep: Q/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open latest docs on github/i })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /show keyboard shortcuts/i }));
    expect(onOpenShortcutsHelp).toHaveBeenCalledTimes(1);

    await userEvent.click(within(docsNav).getByRole('button', { name: /Duplicate Review/i }));
    await userEvent.click(screen.getByRole('button', { name: /open duplicate settings/i }));
    expect(onOpenSettings).toHaveBeenCalledWith('duplicates');
  });

  test('traps focus inside the modal and restores the previous focus when it closes', async () => {
    function ModalHarness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setIsOpen(true)}>Open docs</button>
          {isOpen && (
            <DocumentationModal
              onClose={() => setIsOpen(false)}
              onOpenSettings={() => {}}
              onOpenShortcutsHelp={() => {}}
            />
          )}
        </div>
      );
    }

    render(<ModalHarness />);

    const openButton = screen.getByRole('button', { name: 'Open docs' });
    openButton.focus();
    await userEvent.click(openButton);

    const search = screen.getByRole('searchbox', { name: /search documentation/i });
    const githubLink = screen.getByRole('button', { name: /open project docs on github/i });

    expect(document.activeElement).toBe(search);

    githubLink.focus();
    fireEvent.keyDown(githubLink, { key: 'Tab' });
    expect(document.activeElement).toBe(search);

    search.focus();
    fireEvent.keyDown(search, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(githubLink);

    await userEvent.click(screen.getByRole('button', { name: 'Close documentation' }));
    expect(document.activeElement).toBe(openButton);
  });

  test('keeps the external docs link in the footer instead of the header action area', async () => {
    const electronAPI = installElectronApiMock();
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /open project docs on github/i }));
    expect(electronAPI.openExternalUrl).toHaveBeenCalledTimes(1);
  });
});
