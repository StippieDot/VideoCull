import { useRef } from 'react';

export default function useActiveValue<T>(value: T, active: boolean): T {
  const activeValueRef = useRef(value);
  if (active) activeValueRef.current = value;
  return activeValueRef.current;
}
