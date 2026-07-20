import duplicateReviewSource from '../../docs/features/duplicate-review.mdx?raw';
import gridViewSource from '../../docs/features/grid-view.mdx?raw';
import quickStartSource from '../../docs/getting-started/quickstart.mdx?raw';
import faqSource from '../../docs/help/faq.mdx?raw';
import troubleshootingSource from '../../docs/help/troubleshooting.mdx?raw';
import reviewModeSource from '../../docs/features/review-mode.mdx?raw';
import keyboardShortcutsSource from '../../docs/reference/keyboard-shortcuts.mdx?raw';
import settingsSource from '../../docs/reference/settings.mdx?raw';
import supportedFormatsSource from '../../docs/reference/supported-formats.mdx?raw';

const DOC_IMAGES = import.meta.glob('../../docs/screenshots/*', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

export const DOCUMENTATION_SITE_URL = 'https://videocull.mintlify.site';

export type DocumentationActionId =
  | 'show-shortcuts'
  | 'open-settings-interface'
  | 'open-settings-duplicates'
  | 'open-settings-keybindings'
  | 'open-settings-cache'
  | 'open-settings-processing'
  | 'open-settings-about';

export type DocumentationTask = {
  id: string;
  title: string;
  detail: string;
  pageId: string;
  sectionId?: string;
};

export type DocumentationHeading = {
  id: string;
  level: 2 | 3;
  title: string;
};

export type DocumentationGroup = 'Get started' | 'Workflows' | 'Reference' | 'Help';

export type DocumentationNode =
  | { type: 'heading'; level: 2 | 3; id: string; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'callout'; variant: 'warning' | 'tip' | 'note' | 'info' | 'check'; nodes: DocumentationNode[] }
  | { type: 'steps'; items: Array<{ title: string; nodes: DocumentationNode[] }> }
  | { type: 'accordions'; items: Array<{ title: string; nodes: DocumentationNode[] }> }
  | { type: 'cards'; cards: Array<{ title: string; href: string; body: string }> };

export type DocumentationPage = {
  id: string;
  group: DocumentationGroup;
  navigationTitle: string;
  title: string;
  summary: string;
  href: string;
  actions?: DocumentationActionId[];
  tasks?: DocumentationTask[];
  headings: DocumentationHeading[];
  nodes: DocumentationNode[];
  searchableText: string;
};

type InAppMeta = {
  summary?: string;
  actions?: DocumentationActionId[];
  tasks?: DocumentationTask[];
};

export type DocumentationSource = {
  id: string;
  group: DocumentationGroup;
  navigationTitle?: string;
  href: string;
  raw: string;
};

const IN_APP_META_RE = /<!--\s*in-app-meta\s*([\s\S]*?)-->/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const DOCUMENTATION_SOURCES: DocumentationSource[] = [
  { id: 'quick-start', group: 'Get started', navigationTitle: 'Quick start', href: '/getting-started/quickstart', raw: quickStartSource },
  { id: 'grid-view', group: 'Workflows', href: '/features/grid-view', raw: gridViewSource },
  { id: 'review-mode', group: 'Workflows', href: '/features/review-mode', raw: reviewModeSource },
  { id: 'duplicate-review', group: 'Workflows', href: '/features/duplicate-review', raw: duplicateReviewSource },
  { id: 'settings', group: 'Reference', href: '/reference/settings', raw: settingsSource },
  { id: 'keyboard-shortcuts', group: 'Reference', href: '/reference/keyboard-shortcuts', raw: keyboardShortcutsSource },
  { id: 'supported-formats', group: 'Reference', href: '/reference/supported-formats', raw: supportedFormatsSource },
  { id: 'troubleshooting', group: 'Help', href: '/help/troubleshooting', raw: troubleshootingSource },
  { id: 'faq', group: 'Help', href: '/help/faq', raw: faqSource },
];

export const DOCUMENTATION_ACTIONS: Record<DocumentationActionId, { label: string; description: string }> = {
  'show-shortcuts': {
    label: 'Show keyboard shortcuts',
    description: 'Open the shortcut overlay with the live bindings you use in review mode.',
  },
  'open-settings-interface': {
    label: 'Open interface settings',
    description: 'Adjust layout, sort defaults, and the folder-grouping behavior.',
  },
  'open-settings-duplicates': {
    label: 'Open duplicate settings',
    description: 'Tune similarity, sample count, keeper rules, and ignored matches.',
  },
  'open-settings-keybindings': {
    label: 'Open keybinding settings',
    description: 'Change the review, preview, and global shortcuts used in the app.',
  },
  'open-settings-cache': {
    label: 'Open cache settings',
    description: 'Choose where cache data lives and whether old cache paths are cleaned up.',
  },
  'open-settings-processing': {
    label: 'Open processing settings',
    description: 'Adjust thumbnail count, concurrency, and processing cost.',
  },
  'open-settings-about': {
    label: 'Open About settings',
    description: 'Jump to version, release, and project links from inside the app.',
  },
};

function stripQuotes(value: string) {
  return value.replace(/^["']|["']$/g, '').trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrontmatter(raw: string) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return {};
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = stripQuotes(line.slice(separator + 1).trim());
    if (key) frontmatter[key] = value;
  }
  return frontmatter;
}

function parseInAppMeta(raw: string): InAppMeta {
  const match = raw.match(IN_APP_META_RE);
  if (!match) return {};
  return JSON.parse(match[1].trim()) as InAppMeta;
}

function stripFrontmatterAndMeta(raw: string) {
  return raw
    .replace(FRONTMATTER_RE, '')
    .replace(IN_APP_META_RE, '')
    .trim();
}

function normalizeInlineMarkdown(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseImageAsset(src: string) {
  const decoded = decodeURIComponent(src);
  const basename = decoded.split('/').pop() ?? decoded;
  const match = Object.entries(DOC_IMAGES).find(([path]) => path.endsWith(`/${basename}`));
  return match?.[1] ?? src;
}

function flushParagraph(paragraphLines: string[], nodes: DocumentationNode[]) {
  if (paragraphLines.length === 0) return;
  nodes.push({
    type: 'paragraph',
    text: normalizeInlineMarkdown(paragraphLines.join(' ')),
  });
  paragraphLines.length = 0;
}

function parseBlocks(source: string): DocumentationNode[] {
  const lines = source.split(/\r?\n/);
  const nodes: DocumentationNode[] = [];
  const paragraph: string[] = [];
  const headingCounts = new Map<string, number>();

  const flush = () => flushParagraph(paragraph, nodes);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      flush();
      continue;
    }

    const codeFenceMatch = trimmed.match(/^```([\w-]*)$/);
    if (codeFenceMatch) {
      flush();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== '```') {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      nodes.push({
        type: 'code',
        language: codeFenceMatch[1] ?? '',
        content: codeLines.join('\n'),
      });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length as 2 | 3;
      const text = headingMatch[2].trim();
      const slug = slugify(text);
      const count = (headingCounts.get(slug) ?? 0) + 1;
      headingCounts.set(slug, count);
      nodes.push({
        type: 'heading',
        level,
        id: count === 1 ? slug : `${slug}-${count}`,
        text,
      });
      continue;
    }

    const imageMatch = trimmed.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
    if (imageMatch) {
      flush();
      nodes.push({
        type: 'image',
        alt: imageMatch[1],
        src: parseImageAsset(imageMatch[2]),
      });
      continue;
    }

    const calloutMatch = trimmed.match(/^<(Warning|Tip|Note|Info|Check)>$/);
    if (calloutMatch) {
      flush();
      const endTag = `</${calloutMatch[1]}>`;
      const inner: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== endTag) {
        inner.push(lines[index] ?? '');
        index += 1;
      }
      nodes.push({
        type: 'callout',
        variant: calloutMatch[1].toLowerCase() as 'warning' | 'tip' | 'note' | 'info' | 'check',
        nodes: parseBlocks(inner.join('\n')),
      });
      continue;
    }

    if (trimmed.startsWith('<Steps>')) {
      flush();
      const inner: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== '</Steps>') {
        inner.push(lines[index] ?? '');
        index += 1;
      }
      const items = Array.from(
        inner.join('\n').matchAll(/<Step title="([^"]+)">\s*([\s\S]*?)\s*<\/Step>/g),
      ).map((match) => ({
        title: match[1],
        nodes: parseBlocks(match[2]),
      }));
      nodes.push({ type: 'steps', items });
      continue;
    }

    if (trimmed.startsWith('<AccordionGroup>')) {
      flush();
      const inner: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== '</AccordionGroup>') {
        inner.push(lines[index] ?? '');
        index += 1;
      }
      const items = Array.from(
        inner.join('\n').matchAll(/<Accordion title="([^"]+)">\s*([\s\S]*?)\s*<\/Accordion>/g),
      ).map((match) => ({
        title: match[1],
        nodes: parseBlocks(match[2]),
      }));
      nodes.push({ type: 'accordions', items });
      continue;
    }

    if (trimmed.startsWith('<CardGroup')) {
      flush();
      const inner: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== '</CardGroup>') {
        inner.push(lines[index] ?? '');
        index += 1;
      }
      const cards = Array.from(
        inner.join('\n').matchAll(/<Card title="([^"]+)"(?:\s+icon="[^"]*")?\s+href="([^"]+)">\s*([\s\S]*?)\s*<\/Card>/g),
      ).map((match) => ({
        title: match[1],
        href: match[2],
        body: normalizeInlineMarkdown(match[3]),
      }));
      nodes.push({ type: 'cards', cards });
      continue;
    }

    if (trimmed.startsWith('|')) {
      flush();
      const tableLines = [trimmed];
      while (index + 1 < lines.length && (lines[index + 1]?.trim().startsWith('|') ?? false)) {
        index += 1;
        tableLines.push(lines[index]!.trim());
      }
      if (tableLines.length >= 2) {
        nodes.push({
          type: 'table',
          headers: parseTableRow(tableLines[0]!),
          rows: tableLines.slice(2).map(parseTableRow),
        });
        continue;
      }
    }

    const unorderedMatch = trimmed.match(/^-\s+(.+)$/);
    if (unorderedMatch) {
      flush();
      const items: string[] = [unorderedMatch[1]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? '';
        const nextTrimmed = next.trim();
        const nextBullet = nextTrimmed.match(/^-\s+(.+)$/);
        if (nextBullet) {
          items.push(nextBullet[1]);
          index += 1;
          continue;
        }
        if (next.startsWith('  ') || next.startsWith('\t')) {
          items[items.length - 1] = `${items[items.length - 1]} ${nextTrimmed}`.trim();
          index += 1;
          continue;
        }
        break;
      }
      nodes.push({
        type: 'list',
        ordered: false,
        items: items.map(normalizeInlineMarkdown),
      });
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flush();
      const items: string[] = [orderedMatch[1]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? '';
        const nextTrimmed = next.trim();
        const nextOrdered = nextTrimmed.match(/^\d+\.\s+(.+)$/);
        if (nextOrdered) {
          items.push(nextOrdered[1]);
          index += 1;
          continue;
        }
        if (next.startsWith('  ') || next.startsWith('\t')) {
          items[items.length - 1] = `${items[items.length - 1]} ${nextTrimmed}`.trim();
          index += 1;
          continue;
        }
        break;
      }
      nodes.push({
        type: 'list',
        ordered: true,
        items: items.map(normalizeInlineMarkdown),
      });
      continue;
    }

    paragraph.push(trimmed);
  }

  flush();
  return nodes;
}

function collectHeadings(nodes: DocumentationNode[]) {
  return nodes
    .filter((node): node is Extract<DocumentationNode, { type: 'heading' }> => node.type === 'heading')
    .map((node) => ({
      id: node.id,
      level: node.level,
      title: node.text,
    }));
}

function collectSearchText(nodes: DocumentationNode[]): string[] {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case 'heading':
        return [node.text];
      case 'paragraph':
        return [node.text];
      case 'code':
        return [node.content];
      case 'list':
        return node.items;
      case 'table':
        return [node.headers.join(' '), ...node.rows.map((row) => row.join(' '))];
      case 'image':
        return [node.alt];
      case 'callout':
        return collectSearchText(node.nodes);
      case 'steps':
        return node.items.flatMap((item) => [item.title, ...collectSearchText(item.nodes)]);
      case 'accordions':
        return node.items.flatMap((item) => [item.title, ...collectSearchText(item.nodes)]);
      case 'cards':
        return node.cards.flatMap((card) => [card.title, card.body]);
      default:
        return [];
    }
  });
}

export function parseDocumentationPage(source: DocumentationSource): DocumentationPage {
  const frontmatter = parseFrontmatter(source.raw);
  const meta = parseInAppMeta(source.raw);
  const nodes = parseBlocks(stripFrontmatterAndMeta(source.raw));
  const headings = collectHeadings(nodes);
  const title = frontmatter.title ?? source.id;
  const navigationTitle = source.navigationTitle ?? title;
  const searchableText = [
    title,
    navigationTitle,
    meta.summary ?? frontmatter.description ?? '',
    ...(meta.tasks?.flatMap((task) => [task.title, task.detail]) ?? []),
    ...collectSearchText(nodes),
  ].join(' ').toLowerCase();

  return {
    id: source.id,
    group: source.group,
    href: source.href,
    navigationTitle,
    title,
    summary: meta.summary ?? frontmatter.description ?? '',
    actions: meta.actions,
    tasks: meta.tasks,
    headings,
    nodes,
    searchableText,
  };
}

export function resolveDocumentationHref(href: string) {
  return href.startsWith('/') ? `${DOCUMENTATION_SITE_URL}${href}` : href;
}

export const DOCUMENTATION_PAGES: DocumentationPage[] = DOCUMENTATION_SOURCES.map(parseDocumentationPage);

export const DOCUMENTATION_PAGE_ID_BY_HREF = Object.fromEntries(
  DOCUMENTATION_PAGES.map((page) => [page.href, page.id]),
) as Record<string, string>;
