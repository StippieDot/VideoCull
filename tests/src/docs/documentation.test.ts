import { describe, expect, test } from 'vitest';
import { DOCUMENTATION_PAGES } from '../../../src/docs/documentation';

describe('documentation source adapter', () => {
  test('builds task-first pages from the Mintlify MDX files', () => {
    const quickStart = DOCUMENTATION_PAGES.find((page) => page.id === 'quick-start');

    expect(quickStart?.title).toBe('Get started with Video Cull');
    expect(quickStart?.tasks?.some((task) => task.sectionId === 'main-workflow')).toBe(true);
    expect(quickStart?.headings.map((heading) => heading.title)).toEqual(
      expect.arrayContaining([
        'Main workflow',
        'Build a session',
        'Delete safety',
        'Suggested workflow',
      ])
    );
    expect(quickStart?.nodes.some((node) => node.type === 'steps')).toBe(true);
    expect(quickStart?.nodes.some((node) => node.type === 'cards')).toBe(true);
  });

  test('extracts mdx structures instead of hardcoded in-app prose', () => {
    const duplicateReview = DOCUMENTATION_PAGES.find((page) => page.id === 'duplicate-review');

    expect(duplicateReview?.summary).toContain('suggestion engine');
    expect(duplicateReview?.headings.map((heading) => heading.id)).toContain('thresholds-and-sample-count');
    expect(duplicateReview?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image' }),
        expect.objectContaining({ type: 'callout' }),
      ])
    );
  });
});
