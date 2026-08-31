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
    expect(within(header as HTMLElement).getByRole('button', { name: /open web docs/i })).toBeTruthy();
    expect(within(header as HTMLElement).getByRole('button', { name: /close documentation/i })).toBeTruthy();
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
    expect(screen.queryByRole('navigation', { name: /on this page/i })).toBeNull();
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

  test('searches content from a later collapsed section', async () => {
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
    expect((document.getElementById('settings-cache') as HTMLDetailsElement).open).toBe(false);
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
    expect(document.querySelector('#review-mode-use-keyboard-controls summary')?.textContent).toBe('Use keyboard controls');
  });

  test('renders the first Settings section open and later sections closed', async () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    await userEvent.click(within(docsNav).getByRole('button', { name: 'Settings' }));

    const sections = Array.from(document.querySelectorAll<HTMLDetailsElement>('.documentation-mdx > details'));
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0]?.open).toBe(true);
    expect(sections.slice(1).every((section) => !section.open)).toBe(true);
    expect(within(sections[0]!.querySelector('summary')!).getByRole('heading', {
      name: 'Before changing defaults',
    })).toBeTruthy();
  });

  test('opens and scrolls the selected Settings section without moving focus', async () => {
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
    const cacheSection = document.getElementById('settings-cache') as HTMLDetailsElement;
    Object.defineProperty(cacheSection, 'scrollIntoView', { value: scrollIntoView });
    selector.focus();

    await userEvent.selectOptions(selector, 'cache');

    expect(cacheSection.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(document.activeElement).toBe(selector);
  });

  test('resets disclosure defaults after switching pages', async () => {
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const docsNav = screen.getByRole('navigation', { name: /documentation pages/i });
    await userEvent.click(within(docsNav).getByRole('button', { name: 'Settings' }));
    const cacheSection = document.getElementById('settings-cache') as HTMLDetailsElement;
    Object.defineProperty(cacheSection, 'scrollIntoView', { value: vi.fn() });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Jump to section' }), 'cache');
    expect(cacheSection.open).toBe(true);
    const firstSection = document.querySelector<HTMLDetailsElement>('.documentation-mdx > details');
    await userEvent.click(firstSection!.querySelector('summary')!);
    expect(firstSection?.open).toBe(false);

    await userEvent.click(within(docsNav).getByRole('button', { name: 'Grid view' }));
    await userEvent.click(within(docsNav).getByRole('button', { name: 'Settings' }));

    const sections = Array.from(document.querySelectorAll<HTMLDetailsElement>('.documentation-mdx > details'));
    expect(sections[0]?.open).toBe(true);
    expect((document.getElementById('settings-cache') as HTMLDetailsElement).open).toBe(false);
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
    expect(document.querySelector('#supported-formats-built-in-player summary')?.textContent).toBe('Built-in player');

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
    const summaries = modal.querySelectorAll<HTMLElement>('.documentation-mdx > details > summary');
    const lastVisibleFocusable = summaries[summaries.length - 1];

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

  test('opens the web documentation from the header instead of a footer action', async () => {
    const electronAPI = installElectronApiMock();
    render(
      <DocumentationModal
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenShortcutsHelp={() => {}}
      />
    );

    const header = document.querySelector('.documentation-header');
    expect(header).toBeTruthy();
    await userEvent.click(within(header as HTMLElement).getByRole('button', { name: /open web docs/i }));
    expect(electronAPI.openExternalUrl).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.documentation-footer')).toBeNull();
  });
});
