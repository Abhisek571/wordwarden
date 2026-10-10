import React from 'react';
import { MARK_SQUIGGLE, MARK_VIEWBOX, MARK_W_BALL, MARK_W_PATHS, MARK_W_TRANSFORM } from './brand-mark';

/** Wordwarden's mark: an italic w resting on a spelling squiggle. */
export function BrandMark(): React.JSX.Element {
  return (
    <svg className="mark-logo" viewBox={MARK_VIEWBOX} aria-hidden="true">
      <rect width="128" height="128" rx="28" className="mark-logo-tile" />
      <g className="mark-logo-w" transform={MARK_W_TRANSFORM}>
        {MARK_W_PATHS.map((d) => <path key={d} d={d} />)}
        <circle {...MARK_W_BALL} />
      </g>
      <path d={MARK_SQUIGGLE} className="mark-logo-squiggle" />
    </svg>
  );
}

export function CloseIcon(): React.JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
