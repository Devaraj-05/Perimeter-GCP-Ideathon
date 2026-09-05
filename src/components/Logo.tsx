import React from 'react';

/**
 * The Perimeter mark.
 *
 * A boundary with one opening, and something coming through it.
 *
 * The name is the idea, so the mark draws the name. This product does not keep
 * the untrusted world out — it is a journal that reads your email, your web
 * pages and your repositories on purpose. What it does is force all of that
 * through a single controlled opening. A closed shield would describe a
 * different, less interesting product; a sparkle would describe no product at
 * all.
 *
 * Deliberately two elements, not fourteen. The mark before this one carried a
 * shield, a letterform, an orbit and two nodes, and at the 19px it actually
 * ships at in the navbar that resolved to a blob. An enclosure plus a dot is
 * about the most detail that survives at that size.
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
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label={title}
  >
    {/*
      The boundary, drawn as one open path rather than a closed shape with the
      gap masked out. Starting below the opening and ending above it means the
      gap is absent from the geometry rather than painted over, so it survives
      any stroke width, any scale, and a forced-colours mode.
    */}
    <path d="M3.4 14.7V17a3.6 3.6 0 0 0 3.6 3.6h10a3.6 3.6 0 0 0 3.6-3.6V7A3.6 3.6 0 0 0 17 3.4H7A3.6 3.6 0 0 0 3.4 7v2.3" />

    {/* The inner door. What arrives through the opening does not land inside
        the boundary — it meets a second barrier first, which is the airlock
        this whole application is built around. One stroke, because a mark that
        needs a third element to be understood is a diagram. */}
    <path d="M9.2 8.8v6.4" />

    {/* What comes through it. Filled, so it reads as matter arriving rather
        than as another piece of the boundary. */}
    <circle cx="3.4" cy="12" r="1.9" fill="currentColor" stroke="none" />
  </svg>
);
