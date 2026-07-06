// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DocumentationModal from '../../../src/components/DocumentationModal';

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows the getting-started page first and switches pages from the nav', async () => {
    render(<DocumentationModal onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Documentation' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What is Video Cull?' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Opening folders and building a session' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The main workflow: scan → review → delete' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Duplicate Review' }));

    expect(screen.getByRole('heading', { name: 'Visual vs. pHash' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Suggested keeper, right-click actions, and batch actions' })).toBeTruthy();
    expect(screen.getByText(/Use checkboxes for batch actions and right-click for per-video actions\./i)).toBeTruthy();
  });

  test('covers the review, cache, safety, and faq pages with the shipped sections', async () => {
    render(<DocumentationModal onClose={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Review Mode' }));
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Playback, bookmarks, and external player fallback' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Scope, progress, and decision flow' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cache and Processing' }));
    expect(screen.getByRole('heading', { name: 'Cache storage modes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Thumbnail generation settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Which settings apply now vs. next run' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Delete and Safety' }));
    expect(screen.getByRole('heading', { name: 'Marking vs. deleting' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recycle Bin behavior' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Empty-folder cleanup' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'FAQ' }));
    expect(screen.getByText(/Which video formats are supported\?/i)).toBeTruthy();
    expect(screen.getByText(/Why are some videos opened in the external player\?/i)).toBeTruthy();
    expect(screen.getByText(/How do I move cache to a new drive\?/i)).toBeTruthy();
  });

  test('opens the latest hosted docs link and closes from the close button', async () => {
    const electronAPI = installElectronApiMock();
    const onClose = vi.fn();
    render(<DocumentationModal onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open latest docs on GitHub' }));
    expect(electronAPI.openExternalUrl).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Close documentation' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
