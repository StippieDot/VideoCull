import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import useStore from '../store';

/** "Group 3 of 40" beside the duplicates part of the title bar: step through groups or type one to go to. */
export default function DuplicateStepper() {
  const position = useStore((s) => s.duplicatePosition);
  const [draft, setDraft] = useState<string | null>(null);
  if (!position || position.total === 0) return null;
  const { group, total } = position;
  const go = (index: number) => useStore.getState().requestDuplicateGroupJump(Math.max(0, Math.min(total - 1, index)));
  const submit = () => {
    const number = Number.parseInt(draft ?? '', 10);
    if (Number.isFinite(number)) go(number - 1);
    setDraft(null);
  };

  return (
    <span className="duplicate-stepper">
      <button
        type="button"
        className="location-bar-chevron"
        title="Previous group"
        aria-label="Previous group"
        disabled={group === 0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => go(group - 1)}
      >
        <ChevronUp size={12} aria-hidden="true" />
      </button>
      <span className="duplicate-stepper-text">
        Group
        <input
          className="duplicate-stepper-input"
          aria-label={`Go to group, 1 to ${total}`}
          inputMode="numeric"
          value={draft ?? String(group + 1)}
          style={{ width: `calc(${String(total).length}ch + 8px)` }}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              setDraft(null);
              event.currentTarget.blur();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              go(group + (event.key === 'ArrowDown' ? 1 : -1));
            }
          }}
        />
        of {total.toLocaleString()}
      </span>
      <button
        type="button"
        className="location-bar-chevron"
        title="Next group"
        aria-label="Next group"
        disabled={group >= total - 1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => go(group + 1)}
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </span>
  );
}
