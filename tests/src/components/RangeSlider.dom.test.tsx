// @vitest-environment jsdom

import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import RangeSlider from '../../../src/components/RangeSlider';
import { snapSeconds } from '../../../src/components/rangeScale';

function renderSlider(low: number, high: number, onChange = vi.fn()) {
  render(
    <RangeSlider
      min={0}
      max={1000}
      low={low}
      high={high}
      curve={2}
      snap={snapSeconds}
      format={(value) => `${value}s`}
      onChange={onChange}
      lowLabel="Minimum"
      highLabel="Maximum"
    />,
  );
  return onChange;
}

describe('RangeSlider', () => {
  test('moving the low thumb reports a snapped value and keeps the high bound', () => {
    const onChange = renderSlider(0, 1000);
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '500' } });
    expect(onChange).toHaveBeenCalledWith(250, 1000);
  });

  test('the low thumb cannot pass the high thumb', () => {
    const onChange = renderSlider(0, 250);
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '900' } });
    expect(onChange).toHaveBeenCalledWith(250, 250);
  });

  test('the thumb that can still move away is on top when both sit at the far end', () => {
    renderSlider(1000, 1000);
    expect(Number(screen.getByLabelText('Minimum').style.zIndex)).toBeGreaterThan(Number(screen.getByLabelText('Maximum').style.zIndex));
  });

  test('the high thumb is on top when both sit at the start', () => {
    renderSlider(0, 0);
    expect(Number(screen.getByLabelText('Maximum').style.zIndex)).toBeGreaterThan(Number(screen.getByLabelText('Minimum').style.zIndex));
  });

  describe('keyboard steps that snap back to the same value', () => {
    function Controlled() {
      const [range, setRange] = useState({ low: 0, high: 3600 });
      return (
        <RangeSlider
          min={0}
          max={3600}
          low={range.low}
          high={range.high}
          curve={2}
          snap={snapSeconds}
          format={(value) => `${value}s`}
          onChange={(low, high) => setRange({ low, high })}
          lowLabel="Minimum"
          highLabel="Maximum"
        />
      );
    }

    test('the minimum thumb moves one position at a time away from the start', () => {
      render(<Controlled />);
      const low = screen.getByLabelText('Minimum') as HTMLInputElement;
      fireEvent.change(low, { target: { value: '1' } });
      expect(low.value).toBe('1');
      fireEvent.change(low, { target: { value: '2' } });
      expect(low.value).toBe('2');
    });

    test('the maximum thumb moves one position at a time away from the end', () => {
      render(<Controlled />);
      const high = screen.getByLabelText('Maximum') as HTMLInputElement;
      fireEvent.change(high, { target: { value: '999' } });
      expect(high.value).toBe('999');
    });

    test('a value set from outside replaces the remembered position', () => {
      const { rerender } = render(
        <RangeSlider min={0} max={3600} low={0} high={3600} curve={2} snap={snapSeconds} format={(v) => `${v}s`} onChange={() => {}} lowLabel="Minimum" highLabel="Maximum" />,
      );
      fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '1' } });
      rerender(
        <RangeSlider min={0} max={3600} low={900} high={3600} curve={2} snap={snapSeconds} format={(v) => `${v}s`} onChange={() => {}} lowLabel="Minimum" highLabel="Maximum" />,
      );
      expect((screen.getByLabelText('Minimum') as HTMLInputElement).value).toBe('500');
    });
  });
});
