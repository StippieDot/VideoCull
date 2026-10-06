// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import TitleBar from '../../../src/components/TitleBar';
import useStore from '../../../src/store';
import type { PowerState } from '../../../src/types';

function installElectronApiMock(power: PowerState) {
  const electronAPI = {
    getPowerState: vi.fn().mockResolvedValue(power),
    onPowerState: vi.fn(() => () => {}),
    getProcessingPauseState: vi.fn().mockResolvedValue({ status: 'paused' }),
    onProcessingPauseState: vi.fn(() => () => {}),
    openAppMenu: vi.fn().mockResolvedValue(true),
    openFolderMenu: vi.fn().mockResolvedValue(true),
    setProcessingPaused: vi.fn().mockResolvedValue({ status: 'running' }),
  };
  (window as unknown as { electronAPI: typeof electronAPI }).electronAPI = electronAPI;
  return electronAPI;
}

describe('TitleBar', () => {
  beforeEach(() => {
    useStore.setState({
      directories: ['D:\\Videos'],
      isScanning: false,
      isGenerating: true,
      genProgress: { current: 250, total: 1000, phase: 'thumbnails' },
      isFindingDuplicates: false,
    });
  });

  test('shows what is processing, how far it is and that it is paused', async () => {
    installElectronApiMock({ processing: true, finishAction: 'none', countdown: null });
    const { container } = render(<TitleBar isPrivate={false} onOpenCommandPalette={() => {}} />);

    expect(screen.getByRole('status').textContent).toBe(`Thumbnails250 / ${(1000).toLocaleString()}`);
    await screen.findByText('Paused');
    expect(container.querySelector<HTMLElement>('.title-bar-progress-fill')?.style.width).toBe('25%');
    // The folder stays in the centre while processing.
    expect(screen.getByRole('button', { name: /Videos/ })).toBeTruthy();
  });

  test('offers resume while processing is paused', async () => {
    const api = installElectronApiMock({ processing: true, finishAction: 'none', countdown: null });
    render(<TitleBar isPrivate={false} onOpenCommandPalette={() => {}} />);

    act(() => screen.getByRole('button', { name: 'Pause processing' }).click());
    expect(api.setProcessingPaused).toHaveBeenLastCalledWith(true);
    const resume = await screen.findByRole('button', { name: 'Resume processing' });
    act(() => resume.click());
    expect(api.setProcessingPaused).toHaveBeenLastCalledWith(false);
  });

  test('the moon button opens the When Processing Finishes menu and shows the choice', async () => {
    const api = installElectronApiMock({ processing: true, finishAction: 'sleep', countdown: null });
    render(<TitleBar isPrivate={false} onOpenCommandPalette={() => {}} />);

    const button = await screen.findByRole('button', { name: 'When processing finishes: sleep' });
    expect(button.classList.contains('active')).toBe(true);
    act(() => button.click());
    expect(api.openAppMenu).toHaveBeenCalledWith(['Actions', 'When Processing Finishes'], expect.any(Number), expect.any(Number));
  });

  test('the folder name opens the folder menu', async () => {
    const api = installElectronApiMock({ processing: false, finishAction: 'none', countdown: null });
    useStore.setState({ isGenerating: false });
    render(<TitleBar isPrivate={false} onOpenCommandPalette={() => {}} />);

    act(() => screen.getByRole('button', { name: /Videos/ }).click());
    expect(api.openFolderMenu).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  });

  test('behind the privacy screen neither the folder nor the processing status is shown', async () => {
    installElectronApiMock({ processing: true, finishAction: 'none', countdown: null });
    render(<TitleBar isPrivate onOpenCommandPalette={() => {}} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('VideoCull')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /When processing finishes/ })).toBeNull();
  });
});
