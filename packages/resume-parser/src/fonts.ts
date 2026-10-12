const SERIF = /times|georgia|garamond|cambria|palatino|book antiqua|baskerville|merriweather|minion|caslon|didot|bodoni|charter|constantia|century|libre baskerville|playfair|lora|crimson|source serif|pt serif|noto serif|serif/i;
const MONO = /courier|consolas|mono|menlo|inconsolata|fira code|source code/i;

export function classifyFontFamily(name: string): 'sans' | 'serif' | 'mono' {
  const n = name.replace(/^[A-Z]{6}\+/, '');
  if (MONO.test(n)) return 'mono';
  if (SERIF.test(n) && !/sans/i.test(n)) return 'serif';
  return 'sans';
}
