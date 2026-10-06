import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { AppCommand } from '../types';
import './CommandPalette.css';

/** Electron accelerator text as people know it: "CmdOrCtrl+Plus" becomes "Ctrl++". */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CmdOrCtrl|CommandOrControl/g, 'Ctrl')
    .replace(/Plus/g, '+')
    .replace(/Escape/g, 'Esc')
    .replace(/Comma/g, ',');
}

/** Every word of the query must appear somewhere in the command's menu path. */
export function filterCommands(commands: AppCommand[], query: string): AppCommand[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  return commands.filter((command) => {
    const text = command.path.join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Search and run any menu command from the keyboard (Ctrl+K). */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [commands, setCommands] = useState<AppCommand[]>([]);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.getCommands().then((list) => {
      if (!cancelled) setCommands(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const safeIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${safeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const run = (command: AppCommand | undefined) => {
    if (!command?.enabled) return;
    // Close first: many commands open a dialog of their own.
    onClose();
    void window.electronAPI?.runCommand(command.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((results.length + safeIndex + step) % Math.max(1, results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[safeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <div className="command-palette" role="dialog" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-search">
          <Search size={15} />
          <input
            autoFocus
            value={query}
            placeholder="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={results[safeIndex] ? `command-${safeIndex}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <ul className="command-palette-results" id="command-palette-results" role="listbox" ref={listRef}>
          {results.length === 0 && <li className="command-palette-empty">No matching commands</li>}
          {results.map((command, index) => (
            <li
              key={command.id}
              id={`command-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === safeIndex}
              aria-disabled={!command.enabled}
              className={`command-palette-item${index === safeIndex ? ' active' : ''}${command.enabled ? '' : ' disabled'}`}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => run(command)}
            >
              <span className="command-palette-check">{command.checked && <Check size={13} />}</span>
              <span className="command-palette-label">
                {command.path.length > 1 && <span className="command-palette-parent">{command.path.slice(0, -1).join(' › ')} › </span>}
                {command.path[command.path.length - 1]}
              </span>
              {command.accelerator && <kbd>{formatAccelerator(command.accelerator)}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
