import { useEffect, useLayoutEffect, useRef } from 'react';
import { animate, useMotionValue } from 'motion/react';
import { prefersReducedMotion } from '../state/time';

export const fmt = (v: number, digits = 1) => {
  const absVal = Math.abs(v);
  const fixed = absVal.toFixed(digits);
  const [intPart, decPart] = fixed.split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const s = decPart !== undefined ? `${intFormatted},${decPart}` : intFormatted;
  return (v < 0 && Number(fixed) !== 0 ? '−' : '') + s;
};

/** Tweens numeric values smoothly instead of jumping. */
export function Num({
  value,
  digits = 1,
  abs = false,
  className = '',
}: {
  value: number;
  digits?: number;
  abs?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(value);
  const render = (v: number) => fmt(abs ? Math.abs(v) : v, digits);

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = render(mv.get());
    return mv.on('change', (v) => {
      if (ref.current) ref.current.textContent = render(v);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, abs]);

  useEffect(() => {
    const c = animate(mv, value, { duration: prefersReducedMotion() ? 0 : 0.22, ease: 'easeOut' });
    return () => c.stop();
  }, [value, mv]);

  return <span ref={ref} className={className ? `tnum ${className}` : 'tnum'} />;
}
