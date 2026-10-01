// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { MinimalVideoSkin, Video, VideoPlayer } from '@videojs/react/video';

// ReviewMode.dom.test.tsx mocks the player, so this renders the real skin to catch
// @videojs/react releases that rename the DOM ReviewMode.tsx and ReviewMode.css rely on.
describe('review player skin contract', () => {
  function renderSkin() {
    const { container } = render(
      <VideoPlayer>
        <MinimalVideoSkin className="review-video-skin">
          <Video src="clip.mp4" />
        </MinimalVideoSkin>
      </VideoPlayer>,
    );
    return container.querySelector<HTMLElement>('.review-video-skin');
  }

  test('puts the app-owned class on the focusable skin root used for keyboard routing', () => {
    const root = renderSkin();
    expect(root).not.toBeNull();
    expect(root!.tabIndex).toBe(0);
    expect(root!.querySelector('video')).not.toBeNull();
  });

  test('exposes the controls structure targeted by the persistent-controls preference', () => {
    const root = renderSkin()!;
    expect(root.hasAttribute('data-controls-visible')).toBe(true);
    for (const selector of ['.video-controls-content', '.video-controls-backdrop']) {
      const element = root.querySelector(selector);
      expect(element, selector).not.toBeNull();
      expect(element!.hasAttribute('data-visible'), selector).toBe(true);
    }
  });
});
