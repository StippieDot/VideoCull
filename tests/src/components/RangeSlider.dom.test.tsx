// @vitest-environment jsdom

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
});
