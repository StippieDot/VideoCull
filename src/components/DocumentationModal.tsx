import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import {
  DOCUMENTATION_ACTIONS,
  DOCUMENTATION_PAGE_ID_BY_HREF,
  DOCUMENTATION_PAGES,
  resolveDocumentationHref,
  type DocumentationActionId,
  type DocumentationNode,
} from '../docs/documentation';
import './DocumentationModal.css';

type DocumentationSettingsTab =
  | 'interface'
  | 'features'
  | 'duplicates'
  | 'keybindings'
  | 'cache'
  | 'processing'
  | 'updates'
  | 'about';

type DocumentationModalProps = {
  onClose: () => void;
  onOpenSettings: (tab: DocumentationSettingsTab) => void;
  onOpenShortcutsHelp: () => void;
};

const SETTINGS_ACTIONS: Partial<Record<DocumentationActionId, DocumentationSettingsTab>> = {
  'open-settings-interface': 'interface',
  'open-settings-duplicates': 'duplicates',
  'open-settings-keybindings': 'keybindings',
  'open-settings-cache': 'cache',
  'open-settings-processing': 'processing',
  'open-settings-about': 'about',
};

const SHORTCUTS_DOC_HREF = '/reference/keyboard-shortcuts';

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function sectionAnchorId(pageId: string, sectionId: string) {
  return `${pageId}-${sectionId}`;
}

function inlineTokenKey(index: number, value: string) {
  return `${index}-${value}`;
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
  const [activePageId, setActivePageId] = useState(DOCUMENTATION_PAGES[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [pendingSectionId, setPendingSectionId] = useState<string | null>(null);
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

  const tocItems = useMemo(() => activePage?.headings ?? [], [activePage]);

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
  }, [activePageId, normalizedQuery]);

  const jumpToSection = (sectionId: string) => {
    const node = document.getElementById(sectionAnchorId(activePage.id, sectionId));
    node?.scrollIntoView({ block: 'start' });
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
    if (href === SHORTCUTS_DOC_HREF) {
      onOpenShortcutsHelp();
      return;
    }

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
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
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
    <div className="documentation-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="documentation-modal"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="documentation-modal-title"
      >
        <div className="documentation-header">
          <div className="documentation-header-copy">
            <h2 id="documentation-modal-title">Documentation</h2>
            <p className="documentation-summary">{activePage.summary}</p>
          </div>
          <div className="documentation-header-actions">
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
              className="documentation-close-btn"
              onClick={onClose}
              aria-label="Close documentation"
              title="Close documentation"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="documentation-toolbar">
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
                <option key={page.id} value={page.id}>{page.title}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="documentation-body">
          <nav className="documentation-nav" aria-label="Documentation pages">
            {visiblePages.map((page) => (
              <button
                key={page.id}
                type="button"
                className={`documentation-nav-btn${page.id === activePage.id ? ' active' : ''}`}
                onClick={() => setActivePageId(page.id)}
              >
                <span>{page.title}</span>
                <small>{page.summary}</small>
              </button>
            ))}
          </nav>

          <article ref={contentRef} className="documentation-content">
            <header className="documentation-page-header">
              <h3>{activePage.title}</h3>
              <p>{activePage.summary}</p>
            </header>

            {activePage.tasks && activePage.tasks.length > 0 && (
              <section className="documentation-task-section">
                <h4>I want to...</h4>
                <div className="documentation-task-grid">
                  {activePage.tasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className="documentation-task-card"
                      onClick={() => selectTaskPage(task.pageId, task.sectionId)}
                    >
                      <strong>{task.title}</strong>
                      <span>{task.detail}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {tocItems.length > 0 && (
              <nav className="documentation-toc" aria-label="On this page">
                {tocItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`documentation-toc-btn${item.level === 3 ? ' secondary' : ''}`}
                    onClick={() => jumpToSection(item.id)}
                  >
                    {item.title}
                  </button>
                ))}
              </nav>
            )}

            <div className="documentation-mdx">
              {renderNodes(activePage.nodes, activePage.id)}
            </div>
          </article>
        </div>

        <div className="documentation-footer">
          <button type="button" className="documentation-link-btn" onClick={openExternal}>
            Open this page on the docs site
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
