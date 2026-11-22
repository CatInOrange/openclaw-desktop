'use strict';
const DEFAULT_THEME = {background: 'rgb(16, 21, 28)', foreground: 'rgb(233, 237, 243)', dark: true};
function normalizeTheme(value) {
  if (!value || typeof value !== 'object' || typeof value.dark !== 'boolean') return null;
  const color = input => {
    if (typeof input !== 'string') return null;
    const match = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/.exec(input);
    return match && match.slice(1).every(n => Number(n) <= 255) ? input : null;
  };
  const background = color(value.background), foreground = color(value.foreground);
  return background && foreground ? {background, foreground, dark: value.dark} : null;
}
module.exports = {DEFAULT_THEME, normalizeTheme};
