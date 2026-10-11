import { useState, type CSSProperties } from 'react';
import { RANGE_STEPS, positionToValue, valueToPosition } from './rangeScale';

interface RangeSliderProps {
  min: number;
  max: number;
  low: number;
  high: number;
  /** Exponent of the power curve between track position and value; above 1 favours small values. */
  curve: number;
  snap: (value: number) => number;
  format: (value: number) => string;
  onChange: (low: number, high: number) => void;
  lowLabel: string;
  highLabel: string;
  disabled?: boolean;
}

/** A two-thumb range over two native sliders, so keyboard and screen reader behaviour comes for free. */
export default function RangeSlider({
  min, max, low, high, curve, snap, format, onChange, lowLabel, highLabel, disabled = false,
}: RangeSliderProps) {
  // The value is snapped, so neighbouring track positions can map back to the same value. Controlling
  // the thumb from the value alone would reset it after every arrow key. The raw position is kept
  // for as long as it still describes the value shown; any other change of the value wins.
  const [raw, setRaw] = useState<{ low: number; high: number } | null>(null);
  const describes = (position: number | undefined, value: number) => (
    position !== undefined && positionToValue(position, max, curve, snap) === value
  );
  const lowPosition = describes(raw?.low, low) ? raw!.low : valueToPosition(low, max, curve);
  const highPosition = describes(raw?.high, high) ? raw!.high : valueToPosition(high, max, curve);
  const style = {
    '--range-start': lowPosition / RANGE_STEPS,
    '--range-end': highPosition / RANGE_STEPS,
    '--range-fill-visible': highPosition > lowPosition ? 1 : 0,
  } as CSSProperties;

  const update = (nextLowPosition: number, nextHighPosition: number) => {
    setRaw({ low: nextLowPosition, high: nextHighPosition });
    onChange(
      positionToValue(nextLowPosition, max, curve, snap),
      positionToValue(nextHighPosition, max, curve, snap),
    );
  };

  // When both thumbs meet, the one on top must be the one that can still move away from that spot.
  const lowOnTop = lowPosition > RANGE_STEPS / 2;

  return (
    <div className="range-filter">
      <div className="range-values">
        <span className={low > min ? 'range-value-set' : undefined}>{format(low)}</span>
        <span className={high < max ? 'range-value-set' : undefined}>{format(high)}</span>
      </div>
      <div className="range-slider" style={style}>
        <input
          className="range-input"
          type="range"
          min={0}
          max={RANGE_STEPS}
          step={1}
          value={lowPosition}
          disabled={disabled}
          style={{ zIndex: lowOnTop ? 2 : 1 }}
          onChange={(e) => update(Math.min(Number(e.target.value), highPosition), highPosition)}
          aria-label={lowLabel}
          aria-valuetext={format(low)}
        />
        <input
          className="range-input"
          type="range"
          min={0}
          max={RANGE_STEPS}
          step={1}
          value={highPosition}
          disabled={disabled}
          style={{ zIndex: lowOnTop ? 1 : 2 }}
          onChange={(e) => update(lowPosition, Math.max(Number(e.target.value), lowPosition))}
          aria-label={highLabel}
          aria-valuetext={format(high)}
        />
      </div>
    </div>
  );
}
