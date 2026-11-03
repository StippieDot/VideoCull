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

describe('DocumentationModal behavior', () => {
  beforeEach(() => {
    installElectronApiMock();
    const store = useStore as typeof useStore & {
      getInitialState: () => ReturnType<typeof useStore.getState>;
    };
    store.setState(store.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows compact grouped navigation and section controls', () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const header = document.querySelector('.documentation-header');
    expect(header).toBeTruthy();
    expect(within(header as HTMLElement).getByRole('heading', { name: 'Help', level: 2 })).toBeTruthy();
    expect(within(header as HTMLElement).getByRole('searchbox', { name: /search documentation/i })).toBeTruthy();
    expect(within(header as HTMLElement).queryByRole('button', { name: /open web docs/i })).toBeNull();
    expect(within(header as HTMLElement).getByRole('button', { name: /close documentation/i })).toBeTruthy();
    const pageHeader = document.querySelector('.documentation-page-header') as HTMLElement;
    expect(within(pageHeader).getByRole('button', { name: /open web docs/i })).toBeTruthy();
    expect(document.querySelector('.documentation-toolbar')).toBeNull();
    expect(screen.queryByText(/complete offline guide/i)).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Get started with VideoCull' })).toBeTruthy();

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    const quickStartNav = within(docsNav).getByRole('button', { name: 'Quick start' });
    expect(quickStartNav.getAttribute('aria-current')).toBe('page');
    expect(within(docsNav).getAllByRole('button').filter((button) => button !== quickStartNav)
      .every((button) => !button.hasAttribute('aria-current'))).toBe(true);
    expect(within(screen.getByRole('combobox', { name: 'Page' })).getByRole('option', {
      name: 'Quick start',
    })).toBeTruthy();
    expect(within(docsNav).getAllByText('Workflows')).toHaveLength(1);
    expect(docsNav.querySelectorAll('small')).toHaveLength(0);
    expect(document.querySelector('.documentation-task-section')).toBeNull();
    expect(screen.getByRole('navigation', { name: /on this page/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Jump to section' })).toBeTruthy();
  });

  test('selects a page through the native Page selector', async () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const pageSelector = screen.getByRole('combobox', { name: 'Page' }) as HTMLSelectElement;
    await userEvent.selectOptions(pageSelector, 'settings');

    expect(pageSelector.value).toBe('settings');
    expect(screen.getByRole('heading', { level: 3, name: 'Settings' })).toBeTruthy();
    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    const currentButtons = within(docsNav).getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'page');
    expect(currentButtons).toHaveLength(1);
    expect(currentButtons[0]?.textContent).toBe('Settings');
  });

  test('searches content from a later section', async () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    await userEvent.type(
      screen.getByRole('searchbox', { name: /search documentation/i }),
      'ongoing housekeeping',
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Settings' })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: /documentation pages/i }))
      .getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(document.getElementById('settings-library-and-cache')?.tagName).toBe('H4');
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
    expect(within(docsNav).getByRole('button', { name: /Duplicate review/i })).toBeTruthy();
    await userEvent.click(within(docsNav).getByRole('button', { name: /Duplicate review/i }));
    expect(screen.getByRole('heading', { name: 'Duplicate review' })).toBeTruthy();

    await userEvent.clear(screen.getByRole('searchbox', { name: /search documentation/i }));
    await userEvent.click(within(docsNav).getByRole('button', { name: /^Keyboard-first video review mode/i }));

    expect(scrollTo).toHaveBeenCalled();
    expect(document.getElementById('review-mode-use-keyboard-controls')?.textContent).toBe('Use keyboard controls');
  });

  test('shows every Settings section open and lists them under On this page', async () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    await userEvent.click(within(docsNav).getByRole('button', { name: 'Settings' }));

    expect(document.querySelectorAll('.documentation-mdx details.documentation-section')).toHaveLength(0);
    const headings = Array.from(document.querySelectorAll<HTMLElement>('.documentation-mdx > .documentation-mdx-h2'));
    expect(headings.length).toBeGreaterThan(1);
    expect(headings[0]?.textContent).toBe('Before changing defaults');

    const toc = screen.getByRole('navigation', { name: /on this page/i });
    const tocButtons = within(toc).getAllByRole('button');
    expect(tocButtons.map((button) => button.textContent)).toEqual(headings.map((heading) => heading.textContent));
    expect(tocButtons[0]?.getAttribute('aria-current')).toBe('location');
  });

  test('scrolls to the selected Settings section without moving focus', async () => {
    const scrollIntoView = vi.fn();

    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    await userEvent.click(within(docsNav).getByRole('button', { name: 'Settings' }));
    const selector = screen.getByRole('combobox', { name: 'Jump to section' });
    const cacheSection = document.getElementById('settings-library-and-cache') as HTMLElement;
    Object.defineProperty(cacheSection, 'scrollIntoView', { value: scrollIntoView });
    selector.focus();

    await userEvent.selectOptions(selector, 'library-and-cache');

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(document.activeElement).toBe(selector);
  });

  test('On this page follows the chosen section and starts over on another page', async () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    await userEvent.click(within(docsNav).getByRole('button', { name: 'Settings' }));
    const cacheSection = document.getElementById('settings-library-and-cache') as HTMLElement;
    const scrollIntoView = vi.fn();
    Object.defineProperty(cacheSection, 'scrollIntoView', { value: scrollIntoView });

    const toc = screen.getByRole('navigation', { name: /on this page/i });
    const cacheButton = within(toc).getByRole('button', { name: cacheSection.textContent ?? '' });
    await userEvent.click(cacheButton);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(cacheButton.getAttribute('aria-current')).toBe('location');
    expect((screen.getByRole('combobox', { name: 'Jump to section' }) as HTMLSelectElement).value).toBe('library-and-cache');

    await userEvent.click(within(docsNav).getByRole('button', { name: 'Grid view' }));
    await userEvent.click(within(docsNav).getByRole('button', { name: 'Settings' }));
    const firstButton = within(screen.getByRole('navigation', { name: /on this page/i })).getAllByRole('button')[0];
    expect(firstButton?.getAttribute('aria-current')).toBe('location');
  });

  test('renders page-specific in-app actions and internal mdx cards', async () => {
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
    await userEvent.click(within(docsNav).getByRole('button', { name: /^Keyboard-first video review mode/i }));

    await userEvent.click(screen.getByRole('button', { name: /show keyboard shortcuts/i }));
    expect(onOpenShortcutsHelp).toHaveBeenCalledTimes(1);

    await userEvent.click(within(docsNav).getByRole('button', { name: /Duplicate review/i }));
    await userEvent.click(screen.getByRole('button', { name: /open duplicate settings/i }));
    expect(onOpenSettings).toHaveBeenCalledWith('duplicates');

    await userEvent.click(within(docsNav).getByRole('button', { name: 'Quick start' }));
    let mdxContent = document.querySelector('.documentation-mdx');
    expect(mdxContent).toBeTruthy();
    await userEvent.click(within(mdxContent as HTMLElement).getByRole('button', { name: /Grid view/i }));
    expect(screen.getByRole('heading', { name: 'Grid view' })).toBeTruthy();

    await userEvent.click(within(docsNav).getByRole('button', { name: 'Quick start' }));
    mdxContent = document.querySelector('.documentation-mdx');
    await userEvent.click(within(mdxContent as HTMLElement).getByRole('button', { name: /Keyboard shortcuts/i }));
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts for fast video culling' })).toBeTruthy();
    expect(onOpenShortcutsHelp).toHaveBeenCalledTimes(1);
  });

  test('keeps the complete in-scope reference pages inside the modal', async () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    expect(within(docsNav).getByRole('button', { name: /^Keyboard shortcuts/i })).toBeTruthy();
    expect(within(docsNav).getByRole('button', { name: /Cache and processing/i })).toBeTruthy();
    expect(within(docsNav).getByRole('button', { name: /Delete and safety/i })).toBeTruthy();
    expect(within(docsNav).getByRole('button', { name: /Troubleshooting/i })).toBeTruthy();

    await userEvent.click(within(docsNav).getByRole('button', { name: /Supported formats/i }));
    expect(document.getElementById('supported-formats-built-in-player')?.textContent).toBe('Built-in player');

    await userEvent.click(within(docsNav).getByRole('button', { name: /^Troubleshooting/i }));
    await userEvent.click(screen.getByText('Thumbnails are not generating or are stuck'));
    expect(screen.getByRole('heading', { name: 'Regenerate affected thumbnails' })).toBeTruthy();
  });

  test('renders the current customized shortcuts in the MDX-defined shortcut tables', async () => {
    useStore.setState((state) => ({
      settings: {
        ...state.settings,
        keyKeep: { key: 'q', ctrl: true, shift: false, alt: true },
      },
    }));

    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    await userEvent.click(within(docsNav).getByRole('button', { name: /^Keyboard shortcuts/i }));

    expect(screen.getByText('Ctrl+Alt+Q')).toBeTruthy();
    expect(screen.getByText('Mark as Keep')).toBeTruthy();
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
    const modal = screen.getByRole('dialog');
    const tocButtons = modal.querySelectorAll<HTMLElement>('.documentation-toc-btn');
    const lastVisibleFocusable = tocButtons[tocButtons.length - 1];

    expect(document.activeElement).toBe(search);

    lastVisibleFocusable.focus();
    fireEvent.keyDown(lastVisibleFocusable, { key: 'Tab' });
    expect(document.activeElement).toBe(search);

    search.focus();
    fireEvent.keyDown(search, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastVisibleFocusable);

    fireEvent.keyDown(modal, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(openButton);
  });

  test('opens the web documentation from the page header instead of a footer action', async () => {
    const electronAPI = installElectronApiMock();
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const pageHeader = document.querySelector('.documentation-page-header');
    expect(pageHeader).toBeTruthy();
    await userEvent.click(within(pageHeader as HTMLElement).getByRole('button', { name: /open web docs/i }));
    expect(electronAPI.openExternalUrl).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.documentation-footer')).toBeNull();
  });
});
