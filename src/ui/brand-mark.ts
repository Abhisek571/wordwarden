/** Shapes of the Wordwarden mark, drawn in a 128-unit box: an italic w resting on a spelling squiggle. */
export const MARK_VIEWBOX = '0 0 128 128';
export const MARK_W_TRANSFORM = 'translate(13 0) skewX(-12)';
export const MARK_W_PATHS = Object.freeze([
  'M22 32h13.5l13 53H42z',
  'M42 85h6.5l18-53H62z',
  'M59.5 32H73l12 53h-6.5z',
  'M78.5 85H85l16.5-43.5-4.6-2z',
  'M13 41c3-6 7.5-9 12-9h3.5v4H25c-3.4 0-6.4 2-8.6 5.8z',
]);
export const MARK_W_BALL = Object.freeze({ cx: 100.5, cy: 40, r: 6.2 });
export const MARK_SQUIGGLE = 'M30 105q6-6.5 12 0t12 0t12 0t12 0t12 0t12 0';
