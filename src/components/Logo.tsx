import React from 'react';

/**
 * The Perimeter mark.
 *
 * A shield with a ring inside it, and a deliberate gap in that ring.
 *
 * The gap is the whole idea. This product does not keep the untrusted world
 * out — it is a journal that reads your email, your web pages and your
 * repositories on purpose. What it does is control the one opening they come
 * through. A closed shield would describe a different, less interesting
 * product, and a generic sparkle would describe no product at all.
 *
 * Drawn rather than borrowed: it inherits `currentColor`, scales from the
 * font size, needs no icon dependency, and is the one mark in the app that is
 * ours.
 */
export const Logo: React.FC<{ className?: string; title?: string }> = ({
  className = 'h-5 w-5',
  title = 'Perimeter',
}) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label={title}
  >
    {/* The boundary */}
    <path d="M12 2.6 20 5.6v6.1c0 4.6-3.3 8.4-8 9.7-4.7-1.3-8-5.1-8-9.7V5.6Z" />
    {/* The controlled opening: one ring, one gap, facing right.
        22.6 is the circumference at r=3.6; 17 drawn, 5.6 open. */}
    <circle
      cx="12"
      cy="11.4"
      r="3.6"
      strokeDasharray="17 5.6"
      transform="rotate(-38 12 11.4)"
    />
  </svg>
);
