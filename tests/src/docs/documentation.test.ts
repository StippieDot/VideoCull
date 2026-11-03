import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  DOCUMENTATION_SITE_URL,
  DOCUMENTATION_PAGES,
  parseDocumentationPage,
  resolveDocumentationHref,
  type DocumentationSource,
} from '../../../src/docs/documentation';

describe('documentation source adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('bundles the grouped in-app documentation pages in navigation order', () => {
    expect(DOCUMENTATION_PAGES.map(({ id, group }) => ({ id, group }))).toEqual([
      { id: 'quick-start', group: 'Get started' },
      { id: 'sessions-folders', group: 'Get started' },
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
    expect(quickStart?.title).toBe('Get started with VideoCull');
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
    expect(duplicateReview?.headings.map((heading) => heading.id)).toContain('tune-matching');
    expect(duplicateReview?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image' }),
        expect.objectContaining({ type: 'callout' }),
      ])
    );
  });

  test('includes session management and the documented grid batch workflow', () => {
    const sessions = DOCUMENTATION_PAGES.find((page) => page.id === 'sessions-folders');
    const grid = DOCUMENTATION_PAGES.find((page) => page.id === 'grid-view');

    expect(sessions?.headings.map((heading) => heading.id)).toEqual(
      expect.arrayContaining(['load-the-first-folder', 'add-or-replace-folders', 'export-a-report'])
    );
    expect(grid?.headings.map((heading) => heading.id)).toEqual(
      expect.arrayContaining(['select-a-batch', 'understand-batch-actions'])
    );
    expect(grid?.searchableText).toContain('shift');
    expect(grid?.nodes.some((node) => node.type === 'steps')).toBe(true);
  });

  test('opens bundled page links on the official documentation domain', () => {
    expect(DOCUMENTATION_SITE_URL).toBe('https://docs.videocull.app');
    expect(resolveDocumentationHref('/features/grid-view')).toBe('https://docs.videocull.app/features/grid-view');
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

  test('keeps only the platform tab for the system the app runs on', () => {
    const source: DocumentationSource = {
      id: 'tabs-fixture',
      group: 'Help',
      href: '/tabs-fixture',
      raw: `---
title: Tabs fixture
---

Shared text.

<Tabs>
  <Tab title="Windows">
    Windows text.

    - first
      - nested
  </Tab>
  <Tab title="macOS">
    macOS text.
  </Tab>
</Tabs>

<Steps>
  <Step title="Install">
    <Tabs>
      <Tab title="Linux">
        Linux text.
      </Tab>
    </Tabs>
  </Step>
</Steps>`,
    };
    const paragraph = (text: string) => ({ type: 'paragraph', text });

    expect(parseDocumentationPage(source, 'Windows').nodes).toEqual([
      paragraph('Shared text.'),
      paragraph('Windows text.'),
      { type: 'list', ordered: false, items: ['first', 'nested'] },
      { type: 'steps', items: [{ title: 'Install', nodes: [] }] },
    ]);
    expect(parseDocumentationPage(source, 'macOS').nodes.slice(0, 2)).toEqual([
      paragraph('Shared text.'),
      paragraph('macOS text.'),
    ]);
    expect(parseDocumentationPage(source, 'Linux').nodes).toEqual([
      paragraph('Shared text.'),
      { type: 'steps', items: [{ title: 'Install', nodes: [paragraph('Linux text.')] }] },
    ]);

    vi.stubGlobal('window', { electronAPI: { platform: 'darwin' } });
    expect(parseDocumentationPage(source).nodes[1]).toEqual(paragraph('macOS text.'));
  });

  test('bundled pages carry no unfiltered platform tabs', () => {
    expect(DOCUMENTATION_PAGES.every((page) => !page.searchableText.includes('<tab'))).toBe(true);
  });

  test('rejects unsupported MDX components instead of rendering broken prose', () => {
    const source: DocumentationSource = {
      id: 'unsupported-fixture',
      group: 'Help',
      href: '/unsupported-fixture',
      raw: `---
title: Unsupported fixture
---

<Frame>
  Unsupported content
</Frame>`,
    };

    expect(() => parseDocumentationPage(source)).toThrow('Unsupported in-app MDX component: Frame');
  });
});
