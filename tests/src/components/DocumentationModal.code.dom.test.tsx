// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../src/docs/documentation', () => ({
  DOCUMENTATION_ACTIONS: {},
  DOCUMENTATION_PAGE_ID_BY_HREF: {},
  DOCUMENTATION_PAGES: [{
    id: 'code-fixture',
    group: 'Help',
    navigationTitle: 'Code fixture',
    title: 'Code fixture',
    summary: 'Renderer fixture',
    href: '/code-fixture',
    headings: [],
    nodes: [{
      type: 'code',
      language: 'powershell',
      content: 'Get-ChildItem -Force',
    }],
    searchableText: 'code fixture renderer fixture get-childitem -force',
  }],
  resolveDocumentationHref: (href: string) => href,
}));

import DocumentationModal from '../../../src/components/DocumentationModal';

test('renders a parsed code node with its language and literal content', () => {
  render(
    <DocumentationModal
      onClose={() => {}}
      onOpenSettings={() => {}}
      onOpenShortcutsHelp={() => {}}
    />
  );

  const code = screen.getByText('Get-ChildItem -Force', { selector: 'code' });
  expect(code.getAttribute('data-language')).toBe('powershell');
  expect(code.parentElement?.tagName).toBe('PRE');
});
