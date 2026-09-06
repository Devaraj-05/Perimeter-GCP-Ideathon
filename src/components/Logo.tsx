import React from 'react';
import { DiIonic } from 'react-icons/di';

/**
 * The Perimeter mark.
 *
 * DiIonic from react-icons, rendered bare — no plate, no tile, no background.
 * It inherits `currentColor`, so it takes the accent on light chrome and
 * white when placed on a dark surface, from one asset. The favicon in
 * index.html carries the same glyph as an inline SVG so the browser tab
 * matches.
 */
export const Logo: React.FC<{ className?: string; title?: string }> = ({
  className = 'h-5 w-5',
  title = 'Perimeter',
}) => <DiIonic className={className} aria-label={title} role="img" />;
