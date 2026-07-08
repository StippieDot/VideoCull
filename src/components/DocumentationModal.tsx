import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import useStore from '../store';
import { formatKeybind } from '../keybinds';
import {
  DOCUMENTATION_ACTIONS,
  DOCUMENTATION_GITHUB_URL,
  DOCUMENTATION_PAGES,
  type DocumentationActionId,
  type DocumentationPage,
  type DocumentationSection,
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

type TocItem = {
  id: string;
  title: string;
};

const SETTINGS_ACTIONS: Partial<Record<DocumentationActionId, DocumentationSettingsTab>> = {
  'open-settings-interface': 'interface',
  'open-settings-duplicates': 'duplicates',
  'open-settings-keybindings': 'keybindings',
  'open-settings-cache': 'cache',
  'open-settings-processing': 'processing',
  'open-settings-about': 'about',
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function sectionText(section: DocumentationSection) {
  return [
    section.title,
    section.whatThisIs,
    section.defaultRecommendation,
    section.changeItWhen,
    ...(section.bullets ?? []),
  ].join(' ').toLowerCase();
}

function pageText(page: DocumentationPage) {
  return [
    page.title,
    page.summary,
    ...(page.tasks?.flatMap((task) => [task.title, task.detail]) ?? []),
    ...page.sections.map(sectionText),
  ].join(' ').toLowerCase();
}

function sectionAnchorId(pageId: string, sectionId: string) {
  return `${pageId}-${sectionId}`;
}

export default function DocumentationModal({
  onClose,
  onOpenSettings,
  onOpenShortcutsHelp,
}: DocumentationModalProps) {
  const settings = useStore((s) => s.settings);
  const [activePageId, setActivePageId] = useState(DOCUMENTATION_PAGES[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const modalRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const reviewShortcutRows = useMemo(() => ([
    ['Keep', formatKeybind(settings.keyKeep)],
    ['Delete', formatKeybind(settings.keyDelete)],
    ['Skip', formatKeybind(settings.keySkip)],
    ['Undo', formatKeybind(settings.keyUndo)],
    ['Play / Pause', formatKeybind(settings.keyPlay)],
    ['Show help', formatKeybind(settings.keyShowHelp)],
  ]), [settings]);

  const normalizedQuery = normalizeSearch(query);
  const visiblePages = useMemo(() => {
    if (normalizedQuery === '') return DOCUMENTATION_PAGES;
    return DOCUMENTATION_PAGES.filter((page) => pageText(page).includes(normalizedQuery));
  }, [normalizedQuery]);

  useEffect(() => {
    if (visiblePages.some((page) => page.id === activePageId)) return;
    setActivePageId(visiblePages[0]?.id ?? DOCUMENTATION_PAGES[0]?.id ?? '');
  }, [activePageId, visiblePages]);

  const activePage = visiblePages.find((page) => page.id === activePageId)
    ?? DOCUMENTATION_PAGES.find((page) => page.id === activePageId)
    ?? DOCUMENTATION_PAGES[0];

  const visibleSections = useMemo(() => {
    if (!activePage) return [];
    if (normalizedQuery === '') return activePage.sections;
    const matchingSections = activePage.sections.filter((section) => sectionText(section).includes(normalizedQuery));
    return matchingSections.length > 0 ? matchingSections : activePage.sections;
  }, [activePage, normalizedQuery]);

  const tocItems = useMemo<TocItem[]>(() => {
    const items = visibleSections.map((section) => ({ id: section.id, title: section.title }));
    if (activePage?.id === 'review-mode') {
      items.push({ id: 'current-shortcuts', title: 'Current shortcuts' });
    }
    return items;
  }, [activePage?.id, visibleSections]);

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

  const openExternal = () => {
    void window.electronAPI?.openExternalUrl(DOCUMENTATION_GITHUB_URL).catch((err) => {
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

  const jumpToSection = (sectionId: string) => {
    const node = document.getElementById(sectionAnchorId(activePage.id, sectionId));
    node?.scrollIntoView({ block: 'start' });
  };

  const selectTaskPage = (pageId: string) => {
    setActivePageId(pageId);
    setQuery('');
  };

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
                      onClick={() => selectTaskPage(task.pageId)}
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
                    className="documentation-toc-btn"
                    onClick={() => jumpToSection(item.id)}
                  >
                    {item.title}
                  </button>
                ))}
              </nav>
            )}

            {visibleSections.map((section) => (
              <section
                key={section.id}
                id={sectionAnchorId(activePage.id, section.id)}
                className="documentation-section"
              >
                <h4>{section.title}</h4>
                <div className="documentation-section-block">
                  <span className="documentation-section-label">What this is</span>
                  <p>{section.whatThisIs}</p>
                </div>
                <div className="documentation-section-block">
                  <span className="documentation-section-label">Default recommendation</span>
                  <p>{section.defaultRecommendation}</p>
                </div>
                <div className="documentation-section-block">
                  <span className="documentation-section-label">Change it when...</span>
                  <p>{section.changeItWhen}</p>
                </div>
                {section.bullets && section.bullets.length > 0 && (
                  <ul className="documentation-bullets">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {activePage.id === 'review-mode' && (
              <section
                id={sectionAnchorId(activePage.id, 'current-shortcuts')}
                className="documentation-section"
              >
                <h4>Current shortcuts</h4>
                <div className="documentation-shortcut-grid">
                  {reviewShortcutRows.map(([label, value]) => (
                    <div key={label} className="documentation-shortcut-row">
                      <span>{label}: {value}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </article>
        </div>

        <div className="documentation-footer">
          <button type="button" className="documentation-link-btn" onClick={openExternal}>
            Open project docs on GitHub
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
