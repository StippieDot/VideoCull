import { describe, expect, test } from 'vitest';
import {
  DOCUMENTATION_PAGES,
  parseDocumentationPage,
  type DocumentationSource,
} from '../../../src/docs/documentation';

describe('documentation source adapter', () => {
  test('bundles the grouped in-app documentation pages in navigation order', () => {
    expect(DOCUMENTATION_PAGES.map(({ id, group }) => ({ id, group }))).toEqual([
      { id: 'quick-start', group: 'Get started' },
      { id: 'grid-view', group: 'Workflows' },
      { id: 'review-mode', group: 'Workflows' },
      { id: 'duplicate-review', group: 'Workflows' },
      { id: 'settings', group: 'Reference' },
      { id: 'keyboard-shortcuts', group: 'Reference' },
      { id: 'supported-formats', group: 'Reference' },
      { id: 'troubleshooting', group: 'Help' },
      { id: 'faq', group: 'Help' },
    ]);
  });

  test('builds task-first pages from the Mintlify MDX files', () => {
    const quickStart = DOCUMENTATION_PAGES.find((page) => page.id === 'quick-start');

    expect(quickStart?.navigationTitle).toBe('Quick start');
    expect(quickStart?.title).toBe('Get started with Video Cull');
    expect(quickStart?.searchableText).toContain('quick start');
    expect(DOCUMENTATION_PAGES.filter((page) => page.id !== 'quick-start')
      .every((page) => page.navigationTitle === page.title)).toBe(true);
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

  test('parses fenced code language and content literally', () => {
    const source: DocumentationSource = {
      id: 'code-fixture',
      group: 'Help',
      href: '/code-fixture',
      raw: `---
title: Code fixture
---

\`\`\`powershell
$path = "**literal**"
  Get-ChildItem $path
\`\`\``,
    };

    expect(parseDocumentationPage(source).nodes).toContainEqual({
      type: 'code',
      language: 'powershell',
      content: '$path = "**literal**"\n  Get-ChildItem $path',
    });
  });
});
