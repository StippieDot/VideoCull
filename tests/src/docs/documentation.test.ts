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
      { id: 'delete-safety', group: 'Workflows' },
      { id: 'settings', group: 'Reference' },
      { id: 'cache-processing', group: 'Reference' },
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
    expect(duplicateReview?.headings.map((heading) => heading.id)).toContain('tune-weak-results');
    expect(duplicateReview?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image' }),
        expect.objectContaining({ type: 'callout' }),
      ])
    );
  });

  test('keeps task links inside the selected in-app documentation subset', () => {
    for (const sourcePage of DOCUMENTATION_PAGES) {
      for (const task of sourcePage.tasks ?? []) {
        const targetPage = DOCUMENTATION_PAGES.find((page) => page.id === task.pageId);

        expect(targetPage, `${sourcePage.id}:${task.id} target page`).toBeDefined();
        if (task.sectionId) {
          expect(
            targetPage?.headings.some((heading) => heading.id === task.sectionId),
            `${sourcePage.id}:${task.id} target section`
          ).toBe(true);
        }
      }
    }
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

  test('marks shortcut tables from MDX for live in-app rendering', () => {
    const keyboardShortcuts = DOCUMENTATION_PAGES.find((page) => page.id === 'keyboard-shortcuts');

    expect(keyboardShortcuts?.nodes.filter((node) => node.type === 'shortcut-table')).toEqual([
      { type: 'shortcut-table', group: 'Global' },
      { type: 'shortcut-table', group: 'Review mode' },
      { type: 'shortcut-table', group: 'Preview' },
    ]);
  });

  test('parses in-app metadata and shortcut markers written as valid MDX comments', () => {
    const source: DocumentationSource = {
      id: 'mdx-comment-fixture',
      group: 'Help',
      href: '/mdx-comment-fixture',
      raw: `---
title: MDX comment fixture
---

{/* in-app-meta
{
  "summary": "Shared metadata",
  "actions": ["show-shortcuts"]
}
*/}

## Shortcuts

{/* in-app-shortcuts:Global */}
| Key | Action |
| --- | --- |
| F1 | Open documentation |
{/* /in-app-shortcuts */}`,
    };

    const page = parseDocumentationPage(source);

    expect(page.summary).toBe('Shared metadata');
    expect(page.actions).toEqual(['show-shortcuts']);
    expect(page.nodes).toContainEqual({ type: 'shortcut-table', group: 'Global' });
    expect(page.nodes.some((node) => node.type === 'table')).toBe(false);
  });

  test('rejects unsupported MDX components instead of rendering broken prose', () => {
    const source: DocumentationSource = {
      id: 'unsupported-fixture',
      group: 'Help',
      href: '/unsupported-fixture',
      raw: `---
title: Unsupported fixture
---

<Tabs>
  Unsupported content
</Tabs>`,
    };

    expect(() => parseDocumentationPage(source)).toThrow('Unsupported in-app MDX component: Tabs');
  });
});
