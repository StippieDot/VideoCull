import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import { ALL_SHORTCUTS, FIXED_SHORTCUTS, formatKeybind, type Keybind } from '../keybinds';
import { DEFAULT_KEYBINDS } from '../keybind-defaults';
import useStore from '../store';
import {
  DOCUMENTATION_ACTIONS,
  DOCUMENTATION_PAGE_ID_BY_HREF,
  DOCUMENTATION_PAGES,
  resolveDocumentationHref,
  type DocumentationActionId,
  type DocumentationNode,
} from '../docs/documentation';
import type { SettingsTab } from './SettingsModal';
import './Dialog.css';
import './DocumentationModal.css';

type DocumentationModalProps = {
  onClose: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
  onOpenShortcutsHelp: () => void;
};

const SETTINGS_ACTIONS: Partial<Record<DocumentationActionId, SettingsTab>> = {
  'open-settings-general': 'general',
  'open-settings-view': 'view',
  'open-settings-library': 'library',
  'open-settings-duplicates': 'duplicates',
  'open-settings-processing': 'processing',
  'open-settings-shortcuts': 'shortcuts',
  'open-settings-about': 'about',
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function sectionAnchorId(pageId: string, sectionId: string) {
  return `${pageId}-${sectionId}`;
}

function inlineTokenKey(index: number, value: string) {
  return `${index}-${value}`;
}

function getFocusableElements(modal: HTMLElement | null) {
  if (!modal) return [];
  const elements = modal.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])'
  );

  return Array.from(elements).filter((element) => {
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== modal) {
      if (ancestor.tagName === 'DETAILS' && !(ancestor as HTMLDetailsElement).open) {
        if (element.tagName !== 'SUMMARY' || element.parentElement !== ancestor) return false;
      }
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

function renderInlineMarkdown(
  value: string,
  onOpenHref: (href: string) => void,
): ReactNode[] {
  const tokens = value.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);

  return tokens.map((token, index) => {
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      const resolvedHref = resolveDocumentationHref(href);
      return (
        <a
          key={inlineTokenKey(index, token)}
          href={resolvedHref}
          onClick={(event) => {
            event.preventDefault();
            onOpenHref(href);
          }}
        >
          {label}
        </a>
      );
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={inlineTokenKey(index, token)}>{token.slice(1, -1)}</code>;
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={inlineTokenKey(index, token)}>{token.slice(2, -2)}</strong>;
    }

    return <Fragment key={inlineTokenKey(index, token)}>{token}</Fragment>;
  });
}

export default function DocumentationModal({
  onClose,
  onOpenSettings,
  onOpenShortcutsHelp,
}: DocumentationModalProps) {
  const settings = useStore((state) => state.settings);
  const [activePageId, setActivePageId] = useState(DOCUMENTATION_PAGES[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [pendingSectionId, setPendingSectionId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const normalizedQuery = normalizeSearch(query);
  const visiblePages = useMemo(() => {
    if (normalizedQuery === '') return DOCUMENTATION_PAGES;
    return DOCUMENTATION_PAGES.filter((page) => page.searchableText.includes(normalizedQuery));
  }, [normalizedQuery]);

  useEffect(() => {
    if (visiblePages.some((page) => page.id === activePageId)) return;
    setActivePageId(visiblePages[0]?.id ?? DOCUMENTATION_PAGES[0]?.id ?? '');
  }, [activePageId, visiblePages]);

  const activePage = visiblePages.find((page) => page.id === activePageId)
    ?? DOCUMENTATION_PAGES.find((page) => page.id === activePageId)
    ?? DOCUMENTATION_PAGES[0];

  const sections = useMemo(
    () => (activePage?.nodes ?? []).filter(
      (node): node is Extract<DocumentationNode, { type: 'heading' }> => node.type === 'heading' && node.level === 2,
    ),
    [activePage],
  );
  const currentSectionId = sections.some((section) => section.id === activeSectionId)
    ? activeSectionId
    : sections[0]?.id ?? null;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (typeof contentRef.current?.scrollTo === 'function') {
      contentRef.current.scrollTo({ top: 0 });
    } else if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
    setActiveSectionId(null);
  }, [activePageId, normalizedQuery]);

  const jumpToSection = (sectionId: string) => {
    document.getElementById(sectionAnchorId(activePage.id, sectionId))?.scrollIntoView({ block: 'start' });
    setActiveSectionId(sectionId);
  };

  // The section whose heading has scrolled past the top of the article is the one being read.
  const trackActiveSection = () => {
    const content = contentRef.current;
    if (!content) return;
    const readingLine = content.getBoundingClientRect().top + 32;
    let current = sections[0]?.id ?? null;
    for (const section of sections) {
      const heading = document.getElementById(sectionAnchorId(activePage.id, section.id));
      if (heading && heading.getBoundingClientRect().top <= readingLine) current = section.id;
    }
    setActiveSectionId(current);
  };

  useEffect(() => {
    if (!pendingSectionId) return;
    const frame = window.requestAnimationFrame(() => {
      jumpToSection(pendingSectionId);
      setPendingSectionId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePageId, pendingSectionId]);

  const openExternal = () => {
    void window.electronAPI?.openExternalUrl(resolveDocumentationHref(activePage.href)).catch((err) => {
      console.warn('[documentation] Failed to open external URL:', err);
    });
  };

  const openAction = (actionId: DocumentationActionId) => {
    if (actionId === 'show-shortcuts') {
      onOpenShortcutsHelp();
      return;
    }
    const targetTab = SETTINGS_ACTIONS[actionId];
    if (targetTab) onOpenSettings(targetTab);
  };

  const selectTaskPage = (pageId: string, sectionId?: string) => {
    setActivePageId(pageId);
    setQuery('');
    if (sectionId) setPendingSectionId(sectionId);
  };

  const openHref = (href: string) => {
    const pageId = DOCUMENTATION_PAGE_ID_BY_HREF[href];
    if (pageId) {
      selectTaskPage(pageId);
      return;
    }

    void window.electronAPI?.openExternalUrl(resolveDocumentationHref(href)).catch((err) => {
      console.warn('[documentation] Failed to open documentation href:', err);
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements(modalRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const preferredFirst = searchRef.current ?? first;
    if (event.shiftKey && document.activeElement === preferredFirst) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      preferredFirst.focus();
    }
  };

  const renderNodes = (nodes: DocumentationNode[], keyPrefix: string): ReactNode[] => nodes.map((node, index) => {
    const key = `${keyPrefix}-${node.type}-${index}`;

    switch (node.type) {
      case 'heading': {
        const headingId = sectionAnchorId(activePage.id, node.id);
        if (node.level === 2) {
          return <h4 key={key} id={headingId} className="documentation-mdx-h2">{node.text}</h4>;
        }
        return <h5 key={key} id={headingId} className="documentation-mdx-h3">{node.text}</h5>;
      }

      case 'paragraph':
        return (
          <p key={key} className="documentation-mdx-paragraph">
            {renderInlineMarkdown(node.text, openHref)}
          </p>
        );

      case 'code':
        return (
          <pre key={key} className="documentation-mdx-code">
            <code data-language={node.language}>{node.content}</code>
          </pre>
        );

      case 'list': {
        const ListTag = node.ordered ? 'ol' : 'ul';
        return (
          <ListTag key={key} className={`documentation-mdx-list${node.ordered ? ' ordered' : ''}`}>
            {node.items.map((item, itemIndex) => (
              <li key={`${key}-item-${itemIndex}`}>{renderInlineMarkdown(item, openHref)}</li>
            ))}
          </ListTag>
        );
      }

      case 'table':
        return (
          <div key={key} className="documentation-mdx-table-wrap">
            <table className="documentation-mdx-table">
              <thead>
                <tr>
                  {node.headers.map((header, headerIndex) => (
                    <th key={`${key}-header-${headerIndex}`}>{renderInlineMarkdown(header, openHref)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row, rowIndex) => (
                  <tr key={`${key}-row-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${key}-cell-${rowIndex}-${cellIndex}`}>
                        {renderInlineMarkdown(cell, openHref)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'shortcut-table': {
        const configurable = ALL_SHORTCUTS.filter((shortcut) => shortcut.group === node.group);
        const fixed = FIXED_SHORTCUTS.filter((shortcut) => shortcut.group === node.group);
        return (
          <div key={key} className="documentation-mdx-table-wrap">
            <table className="documentation-mdx-table">
              <thead>
                <tr><th>Shortcut</th><th>Action</th></tr>
              </thead>
              <tbody>
                {configurable.map((shortcut) => (
                  <tr key={shortcut.id}>
                    <td><code>{formatKeybind((settings[shortcut.id] ?? DEFAULT_KEYBINDS[shortcut.id]) as Keybind)}</code></td>
                    <td>
                      {shortcut.description}
                      {shortcut.context === 'playing' ? ' (playing)' : shortcut.context === 'not-playing' ? ' (not playing)' : ''}
                    </td>
                  </tr>
                ))}
                {fixed.map((shortcut) => (
                  <tr key={`${node.group}-${shortcut.description}`}>
                    <td><code>{shortcut.keys.join(' / ')}</code></td>
                    <td>{shortcut.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'image':
        return (
          <figure key={key} className="documentation-mdx-figure">
            <img src={node.src} alt={node.alt} className="documentation-mdx-image" />
          </figure>
        );

      case 'callout':
        return (
          <div key={key} className={`documentation-callout ${node.variant}`}>
            {renderNodes(node.nodes, key)}
          </div>
        );

      case 'steps':
        return (
          <div key={key} className="documentation-steps-block">
            {node.items.map((item, itemIndex) => (
              <section key={`${key}-step-${itemIndex}`} className="documentation-step-card">
                <div className="documentation-step-index">{itemIndex + 1}</div>
                <div className="documentation-step-content">
                  <h5>{item.title}</h5>
                  {renderNodes(item.nodes, `${key}-step-${itemIndex}`)}
                </div>
              </section>
            ))}
          </div>
        );

      case 'accordions':
        return (
          <div key={key} className="documentation-accordion-group">
            {node.items.map((item, itemIndex) => (
              <details key={`${key}-accordion-${itemIndex}`} className="documentation-accordion">
                <summary>{item.title}</summary>
                <div className="documentation-accordion-body">
                  {renderNodes(item.nodes, `${key}-accordion-${itemIndex}`)}
                </div>
              </details>
            ))}
          </div>
        );

      case 'cards':
        return (
          <div key={key} className="documentation-card-grid">
            {node.cards.map((card, cardIndex) => {
              const pageId = DOCUMENTATION_PAGE_ID_BY_HREF[card.href];
              const cardKey = `${key}-card-${cardIndex}`;

              if (pageId) {
                return (
                  <button
                    key={cardKey}
                    type="button"
                    className="documentation-mdx-card"
                    onClick={() => selectTaskPage(pageId)}
                  >
                    <strong>{card.title}</strong>
                    <span>{card.body}</span>
                  </button>
                );
              }

              return (
                <a
                  key={cardKey}
                  className="documentation-mdx-card"
                  href={resolveDocumentationHref(card.href)}
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    event.preventDefault();
                    openHref(card.href);
                  }}
                >
                  <strong>{card.title}</strong>
                  <span>{card.body}</span>
                </a>
              );
            })}
          </div>
        );

      default:
        return null;
    }
  });

  return (
    <div className="dialog-overlay documentation-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="dialog-window documentation-modal"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="documentation-modal-title"
      >
        <div className="dialog-header documentation-header">
          <div className="documentation-header-copy">
            <h2 id="documentation-modal-title">Help</h2>
          </div>
          <label className="documentation-search">
            <Search size={15} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documentation"
              aria-label="Search documentation"
            />
          </label>
          <label className="documentation-mobile-picker">
            <span>Page</span>
            <select value={activePage.id} onChange={(event) => setActivePageId(event.target.value)}>
              {visiblePages.map((page) => (
                <option key={page.id} value={page.id}>{page.navigationTitle}</option>
              ))}
            </select>
          </label>
          <div className="documentation-header-actions">
            <button
              type="button"
              className="dialog-close-btn"
              onClick={onClose}
              aria-label="Close documentation"
              title="Close documentation"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="documentation-body">
          <nav className="documentation-nav" aria-label="Documentation pages">
            {visiblePages.map((page, index) => (
              <Fragment key={page.id}>
                {(index === 0 || visiblePages[index - 1]?.group !== page.group) && (
                  <div className="documentation-nav-group-label">{page.group}</div>
                )}
                <button
                  type="button"
                  className={`documentation-nav-btn${page.id === activePage.id ? ' active' : ''}`}
                  aria-current={page.id === activePage.id ? 'page' : undefined}
                  onClick={() => setActivePageId(page.id)}
                >
                  {page.navigationTitle}
                </button>
              </Fragment>
            ))}
          </nav>

          <article ref={contentRef} className="documentation-content" onScroll={trackActiveSection}>
            <header className="documentation-page-header">
              <h3>{activePage.title}</h3>
              <p>{activePage.summary}</p>
              <div className="documentation-page-actions">
                {(activePage.actions ?? []).map((actionId) => (
                  <button
                    key={actionId}
                    type="button"
                    className="documentation-action-btn"
                    onClick={() => openAction(actionId)}
                    title={DOCUMENTATION_ACTIONS[actionId].description}
                  >
                    {DOCUMENTATION_ACTIONS[actionId].label}
                  </button>
                ))}
                <button
                  type="button"
                  className="documentation-action-btn documentation-link-btn"
                  onClick={openExternal}
                >
                  Open web docs
                  <ExternalLink size={14} />
                </button>
              </div>
            </header>

            {sections.length >= 2 && (
              <label className="documentation-section-picker">
                <span>Jump to section</span>
                <select
                  value={currentSectionId ?? ''}
                  onChange={(event) => jumpToSection(event.target.value)}
                >
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>{section.text}</option>
                  ))}
                </select>
              </label>
            )}

            <div key={activePage.id} className="documentation-mdx">
              {renderNodes(activePage.nodes, activePage.id)}
            </div>
          </article>

          {sections.length >= 2 && (
            <nav className="documentation-toc" aria-label="On this page">
              <div className="documentation-nav-group-label">On this page</div>
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`documentation-toc-btn${section.id === currentSectionId ? ' active' : ''}`}
                  aria-current={section.id === currentSectionId ? 'location' : undefined}
                  onClick={() => jumpToSection(section.id)}
                >
                  {section.text}
                </button>
              ))}
            </nav>
          )}
        </div>

      </div>
    </div>
  );
}
