import { useEffect, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { DOCUMENTATION_GITHUB_URL, DOCUMENTATION_PAGES } from '../docs/documentation';
import './DocumentationModal.css';

type DocumentationModalProps = {
  onClose: () => void;
};

export default function DocumentationModal({ onClose }: DocumentationModalProps) {
  const [activePageId, setActivePageId] = useState(DOCUMENTATION_PAGES[0]?.id ?? '');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activePage = DOCUMENTATION_PAGES.find((page) => page.id === activePageId) ?? DOCUMENTATION_PAGES[0];

  const openLatestDocs = () => {
    void window.electronAPI?.openExternalUrl(DOCUMENTATION_GITHUB_URL).catch((err) => {
      console.warn('[documentation] Failed to open external URL:', err);
    });
  };

  return (
    <div className="documentation-overlay" onClick={onClose}>
      <div
        className="documentation-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="documentation-modal-title"
      >
        <div className="documentation-header">
          <div>
            <h2 id="documentation-modal-title">Documentation</h2>
            <button type="button" className="documentation-link-btn" onClick={openLatestDocs}>
              Open latest docs on GitHub
              <ExternalLink size={14} />
            </button>
          </div>
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

        <div className="documentation-body">
          <nav className="documentation-nav" aria-label="Documentation pages">
            {DOCUMENTATION_PAGES.map((page) => (
              <button
                key={page.id}
                type="button"
                className={`documentation-nav-btn${page.id === activePage.id ? ' active' : ''}`}
                onClick={() => setActivePageId(page.id)}
              >
                {page.title}
              </button>
            ))}
          </nav>

          <article className="documentation-content">
            <h3>{activePage.title}</h3>
            {activePage.content}
          </article>
        </div>
      </div>
    </div>
  );
}
