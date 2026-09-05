import React, { useEffect, useRef, useState } from 'react';

/**
 * Reveals a section when it is actually reached.
 *
 * The page already had .anim-rise, which fires on mount — fine for a hero,
 * wrong for a section three screens down, which would finish animating long
 * before anyone scrolled to it and then just appear.
 *
 * Falls open. If IntersectionObserver is missing, or the observer never fires
 * for any reason, the content is visible: a decorative animation must never be
 * the thing standing between a reader and the page. The reduced-motion rule
 * lives in CSS (`.reveal` collapses to opacity 1), so this component needs no
 * media query of its own.
 */
export const Reveal: React.FC<{
  children: React.ReactNode;
  delay?: 0 | 1 | 2 | 3;
  className?: string;
  as?: 'div' | 'section';
}> = ({ children, delay = 0, className = '', as: Tag = 'div' }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      // Fire a little before the edge, so the motion finishes as the section
      // settles into view rather than starting once it is already there.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${delay ? `reveal-${delay}` : ''} ${shown ? 'is-in' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
};
