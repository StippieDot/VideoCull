import { Fragment } from 'react';
import { X } from 'lucide-react';
import useStore from '../store';
import { ALL_SHORTCUTS, FIXED_SHORTCUTS, formatKeybind, type ShortcutGroup } from '../keybinds';
import type { Keybind } from '../keybinds';
import { DEFAULT_KEYBINDS } from '../keybind-defaults';
import './Dialog.css';

interface Props {
  onClose: () => void;
  onOpenShortcutSettings: () => void;
}

const GROUPS: ShortcutGroup[] = ['Review mode', 'Global'];

export default function ShortcutsHelp({ onClose, onOpenShortcutSettings }: Props) {
  const settings = useStore((s) => s.settings);

  return (
    <div className="dialog-overlay shortcuts-overlay" onClick={onClose}>
      <div
        className="dialog-window shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button className="dialog-close-btn" onClick={onClose} title="Close (Esc)" aria-label="Close keyboard shortcuts">
            <X size={20} />
          </button>
        </div>

        <div className="shortcuts-body">
          {GROUPS.map((group) => {
            const configurable = ALL_SHORTCUTS.filter((s) => s.group === group);
            const fixed = FIXED_SHORTCUTS.filter((s) => s.group === group);
            const sections = [...new Set([...configurable, ...fixed].map((s) => s.section))];

            return (
              <Fragment key={group}>
                {sections.map((section) => (
                  <div key={section} className="shortcuts-box">
                    <h3 className="shortcuts-box-title">{group === 'Review mode' ? `Review · ${section}` : section}</h3>
                    <div className="shortcuts-rows">
                      {configurable.filter((s) => s.section === section).map((s) => (
                        <div key={s.id} className="shortcuts-row">
                          <span className="shortcuts-desc">
                            {s.description}
                            {s.context === 'not-playing' && <span className="shortcut-context">not playing</span>}
                          </span>
                          <span className="shortcuts-keys">
                            <kbd>{formatKeybind((settings[s.id] ?? DEFAULT_KEYBINDS[s.id]) as Keybind)}</kbd>
                          </span>
                        </div>
                      ))}
                      {fixed.filter((s) => s.section === section).map((s) => (
                        <div key={s.description} className="shortcuts-row">
                          <span className="shortcuts-desc">{s.description}</span>
                          <span className="shortcuts-keys shortcuts-keys-fixed">
                            {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>

        <div className="shortcuts-footer">
          <span className="shortcuts-hint">Dimmed keys are fixed. The others can be changed in Settings.</span>
          <button className="shortcuts-settings-btn" onClick={onOpenShortcutSettings}>Change shortcuts</button>
        </div>
      </div>
    </div>
  );
}
