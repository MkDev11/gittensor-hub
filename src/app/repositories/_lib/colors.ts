/* Label + language color tables — ported verbatim from `repositories.html`.
 *
 * The HTML used these to keep label chips and lang pills consistent across
 * the bar, leaderboard, cards, drawer, and compare modal. Putting them in a
 * shared module so every component renders the same palette. */

export const LABEL_KEYS = ['bug', 'enhancement', 'feature', 'refactor'] as const;
export type LabelKey = typeof LABEL_KEYS[number];

export interface LabelColor {
  fg: string;
  soft: string;
}

export const LABEL_COLORS: Record<string, LabelColor> = {
  bug:         { fg: '#ec4899', soft: 'rgba(236, 72, 153, 0.35)' },
  enhancement: { fg: '#eab308', soft: 'rgba(234, 179, 8, 0.35)' },
  feature:     { fg: '#86efac', soft: 'rgba(134, 239, 172, 0.4)' },
  refactor:    { fg: '#c5503a', soft: 'rgba(197, 80, 58, 0.35)' },
  'benchmark-improvement': { fg: '#7aa6e8', soft: 'rgba(122, 166, 232, 0.35)' },
};

export const LANG_COLORS: Record<string, string> = {
  Python: '#3572A5',
  TypeScript: '#2b7489',
  JavaScript: '#f1e05a',
  Rust: '#dea584',
  Go: '#00ADD8',
  Markdown: '#083fa1',
  HTML: '#e34c26',
  CSS: '#563d7c',
  TSX: '#2b7489',
  JSX: '#f1e05a',
  Java: '#b07219',
  Solidity: '#AA6746',
  Shell: '#89e051',
  YAML: '#cb171e',
  JSON: '#292929',
};

/** Hint color for the strategy chip class (the HTML used different `chip-active-X`
 *  modifier classes per strategy). Returns the name part to combine with our
 *  `chipBug` / `chipEnh` / etc. classes in `page.module.css`. */
export function strategyChipClass(strategy: string): 'chipBug' | 'chipEnh' | 'chipFeat' | 'chipRefact' | 'chipIssue' | 'chipNone' {
  switch (strategy) {
    case 'bug':         return 'chipBug';
    case 'enhancement': return 'chipEnh';
    case 'feature':     return 'chipFeat';
    case 'refactor':    return 'chipRefact';
    case 'issue':       return 'chipIssue';
    default:            return 'chipNone';
  }
}

/** Format a language percentage with adaptive precision.
 *  - >= 10%   → integer    ("90%")
 *  - 1..10%   → one decimal ("8.5%")
 *  - < 1%     → two decimals ("0.20%") so tiny slivers (Shell at 0.2%) don't
 *               round to "0%" and look meaningless.
 *  - 0        → "0%" (genuinely zero) */
export function formatLangPct(p: number): string {
  if (p === 0) return '0%';
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  return `${p.toFixed(2)}%`;
}

/* Reference data: AST and language weight tables (used by the collapsible
 * reference panels). Mirrors the HTML so contributors get the same protocol
 * cheatsheet. */
export const LANGS: Array<[string, number, string | null]> = [
  ['c', 2.0, 'c'], ['cc', 2.0, 'cpp'], ['cpp', 2.0, 'cpp'], ['cs', 2.0, 'csharp'], ['cu', 2.0, 'cuda'],
  ['cxx', 2.0, 'cpp'], ['go', 2.0, 'go'], ['java', 2.0, 'java'], ['rs', 2.0, 'rust'],
  ['cuh', 1.8, 'cuda'], ['h', 1.8, 'c'], ['hh', 1.8, 'cpp'], ['hpp', 1.8, 'cpp'], ['hxx', 1.8, 'cpp'],
  ['d', 1.75, 'd'], ['elm', 1.75, 'elm'], ['hs', 1.75, 'haskell'], ['kt', 1.75, 'kotlin'],
  ['ml', 1.75, 'ocaml'], ['sv', 1.75, 'verilog'], ['vhdl', 1.75, 'vhdl'],
  ['bash', 1.6, 'bash'], ['fish', 1.6, 'fish'], ['ps1', 1.6, 'powershell'], ['sh', 1.6, 'bash'], ['zsh', 1.6, 'bash'],
  ['asm', 1.5, 'asm'], ['clj', 1.5, 'clojure'], ['lua', 1.5, 'lua'], ['py', 1.5, 'python'],
  ['rb', 1.5, 'ruby'], ['sol', 1.5, 'solidity'], ['sql', 1.5, 'sql'], ['swift', 1.5, 'swift'],
  ['php', 1.25, 'php'], ['tsx', 1.25, 'tsx'], ['vue', 1.25, 'vue'],
  ['ts', 1.20, 'typescript'], ['jsx', 1.20, 'javascript'],
  ['js', 1.15, 'javascript'], ['mjs', 1.15, 'javascript'],
  ['yaml', 1.0, null], ['yml', 1.0, null], ['zig', 1.0, 'zig'], ['dockerfile', 1.0, 'dockerfile'],
  ['css', 0.95, 'css'], ['html', 0.75, 'html'],
  ['cfg', 0.5, null], ['ini', 0.5, null], ['toml', 0.5, null],
  ['ipynb', 0.3, null], ['xml', 0.2, null],
  ['csv', 0.1, null], ['json', 0.1, null],
  ['md', 0.08, null], ['mdx', 0.08, null], ['txt', 0.08, null],
];

// Mostly GitHub-linguist brand colors. A few entries are brightened
// because they render as ~10% alpha (`${color}1a`) chip backgrounds and
// near-#000 source colors come out invisible on the dark theme.
export const EXT_COLORS: Record<string, string> = {
  // C family
  c: '#a8b9cc', h: '#a8b9cc', cpp: '#00599c', cxx: '#00599c', cc: '#00599c',
  hpp: '#00599c', hxx: '#00599c', hh: '#00599c', cs: '#178600', cu: '#3a4e3a', cuh: '#3a4e3a',
  rs: '#dea584', go: '#00ADD8', d: '#ba595e', zig: '#ec915c', nim: '#37775b', v: '#4f87c4',
  java: '#b07219', kt: '#A97BFF', scala: '#c22d40', groovy: '#4298b8', clj: '#db5855',
  js: '#f1e05a', mjs: '#f1e05a', cjs: '#f1e05a', ts: '#2b7489', tsx: '#2b7489', jsx: '#f1e05a',
  html: '#e34c26', css: '#563d7c', scss: '#c6538c', sass: '#a53b70', less: '#4d6fa8',
  vue: '#41b883', svelte: '#ff3e00', astro: '#ff5d01',
  py: '#3572A5', rb: '#701516', php: '#4F5D95', pl: '#0298c3',
  // lua: linguist uses #000080 (navy); too dark for our 10%-alpha chip
  // background, so we brighten to a readable blue. ps1 (#012456) hits
  // the same problem.
  lua: '#5d8aff', sh: '#89e051', bash: '#89e051', zsh: '#89e051', fish: '#4aae47', ps1: '#5b8ed1',
  hs: '#5e5086', elm: '#60B5CC', ml: '#3be133', erl: '#A90533', ex: '#6e4a7e', exs: '#6e4a7e',
  fs: '#b845fc', fsx: '#b845fc', ocaml: '#3be133',
  sv: '#DAE1C2', vhdl: '#adb2cb', verilog: '#b2b7f8', asm: '#6E4C13',
  swift: '#ffac45', dart: '#00B4AB', m: '#438eff', mm: '#438eff',
  // json: linguist #292929 is near-invisible at 10%; bump to mid-grey.
  json: '#8d9ba0', yaml: '#cb171e', yml: '#cb171e', toml: '#9c4221', xml: '#0060ac', md: '#083fa1',
  sol: '#AA6746', cairo: '#ff4a48',
};

/* Devicon spec for each extension: [icon-name, variant]. Used by the
 * language-weights panel to render the official language logo, with a
 * colored-letter fallback for extensions Devicon doesn't ship. Mirrors
 * the HTML prototype's EXT_ICONS map. */
export const EXT_ICONS: Record<string, [string, string]> = {
  // C family
  c: ['c', 'original'], h: ['c', 'original'],
  cpp: ['cplusplus', 'original'], cxx: ['cplusplus', 'original'], cc: ['cplusplus', 'original'],
  hpp: ['cplusplus', 'original'], hxx: ['cplusplus', 'original'], hh: ['cplusplus', 'original'],
  cs: ['csharp', 'original'],
  cu: ['nvidia', 'original'], cuh: ['nvidia', 'original'],
  // Systems / compiled
  rs: ['rust', 'plain'], go: ['go', 'original'], d: ['d', 'plain'],
  nim: ['nim', 'plain'], zig: ['zig', 'original'],
  // JVM
  java: ['java', 'original'], kt: ['kotlin', 'original'], scala: ['scala', 'original'],
  groovy: ['groovy', 'plain'], clj: ['clojure', 'plain'],
  // Web
  js: ['javascript', 'original'], mjs: ['javascript', 'original'], cjs: ['javascript', 'original'],
  ts: ['typescript', 'original'], tsx: ['typescript', 'original'], jsx: ['react', 'original'],
  html: ['html5', 'original'], css: ['css3', 'original'],
  scss: ['sass', 'original'], sass: ['sass', 'original'], less: ['less', 'plain-wordmark'],
  vue: ['vuejs', 'original'], svelte: ['svelte', 'original'], astro: ['astro', 'original'],
  // Scripting / dynamic
  py: ['python', 'original'], rb: ['ruby', 'original'], php: ['php', 'original'],
  pl: ['perl', 'original'],
  lua: ['lua', 'original-wordmark'],
  sh: ['bash', 'original'], bash: ['bash', 'original'], zsh: ['zsh', 'original'],
  ps1: ['powershell', 'original'],
  // Functional / academic
  hs: ['haskell', 'original'], elm: ['elm', 'original'],
  ml: ['ocaml', 'original'], ocaml: ['ocaml', 'original'],
  erl: ['erlang', 'original'], ex: ['elixir', 'original'], exs: ['elixir', 'original'],
  fs: ['fsharp', 'original'], fsx: ['fsharp', 'original'],
  // Mobile
  swift: ['swift', 'original'], dart: ['dart', 'original'],
  m: ['objectivec', 'plain'], mm: ['objectivec', 'plain'],
  // Data / markup / infra
  json: ['json', 'plain'], yaml: ['yaml', 'plain'], yml: ['yaml', 'plain'],
  toml: ['toml', 'plain'], xml: ['xml', 'plain'], md: ['markdown', 'original'],
  sql: ['mysql', 'original'],
  dockerfile: ['docker', 'plain'],
  ipynb: ['jupyter', 'plain'],
  // Smart contracts
  sol: ['solidity', 'original'],
};

/* GitHub language-name → Devicon spec. The /repos/metadata endpoint
 * returns languages by GitHub-linguist name (e.g. "Python", "TypeScript",
 * not file extensions), so the repo-card/list-row icon pills need this
 * map. Keys are lower-cased GitHub names; values are the same
 * [icon, variant] tuple Devicon expects. */
export const LANG_NAME_ICONS: Record<string, [string, string]> = {
  python: ['python', 'original'],
  rust: ['rust', 'plain'],
  go: ['go', 'original'],
  javascript: ['javascript', 'original'],
  typescript: ['typescript', 'original'],
  tsx: ['typescript', 'original'],
  jsx: ['react', 'original'],
  html: ['html5', 'original'],
  css: ['css3', 'original'],
  scss: ['sass', 'original'],
  sass: ['sass', 'original'],
  less: ['less', 'plain-wordmark'],
  vue: ['vuejs', 'original'],
  svelte: ['svelte', 'original'],
  astro: ['astro', 'original'],
  java: ['java', 'original'],
  kotlin: ['kotlin', 'original'],
  scala: ['scala', 'original'],
  groovy: ['groovy', 'plain'],
  clojure: ['clojure', 'plain'],
  c: ['c', 'original'],
  'c++': ['cplusplus', 'original'],
  cpp: ['cplusplus', 'original'],
  'c#': ['csharp', 'original'],
  csharp: ['csharp', 'original'],
  cuda: ['nvidia', 'original'],
  d: ['d', 'plain'],
  nim: ['nim', 'plain'],
  zig: ['zig', 'original'],
  ruby: ['ruby', 'original'],
  php: ['php', 'original'],
  perl: ['perl', 'original'],
  lua: ['lua', 'original-wordmark'],
  shell: ['bash', 'original'],
  bash: ['bash', 'original'],
  zsh: ['zsh', 'original'],
  powershell: ['powershell', 'original'],
  haskell: ['haskell', 'original'],
  elm: ['elm', 'original'],
  ocaml: ['ocaml', 'original'],
  erlang: ['erlang', 'original'],
  elixir: ['elixir', 'original'],
  fsharp: ['fsharp', 'original'],
  'f#': ['fsharp', 'original'],
  swift: ['swift', 'original'],
  dart: ['dart', 'original'],
  'objective-c': ['objectivec', 'plain'],
  objectivec: ['objectivec', 'plain'],
  json: ['json', 'plain'],
  yaml: ['yaml', 'plain'],
  toml: ['toml', 'plain'],
  xml: ['xml', 'plain'],
  markdown: ['markdown', 'original'],
  mdx: ['markdown', 'original'],
  sql: ['mysql', 'original'],
  dockerfile: ['docker', 'plain'],
  'jupyter notebook': ['jupyter', 'plain'],
  solidity: ['solidity', 'original'],
  makefile: ['cmake', 'original'],
  r: ['r', 'original'],
  matlab: ['matlab', 'original'],
};
