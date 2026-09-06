export const SYM = {
  agent: '\u25C6',
  step: '\u21B3',
  score: '\u2726',
  finding: '\u2578',
  ok: '\u2713',
  warn: '\u26A0',
  skip: '\u25CB',
  dot: '\u00B7',
  rail: '\u2590',
  input: '\u203A',
  arrow: '\u2192',
  div: '\u2500',
};

export const C = {
  dim: '#3a3a45',
  muted: '#62627a',
  base: '#c2c2ce',
  hi: '#eeeef5',
  blue: '#5b9cf6',
  cyan: '#42c9e5',
  green: '#5ecb82',
  yellow: '#efc02a',
  red: '#eb6060',
  purple: '#a87ef5',
  orange: '#ef9850',
};

export const BANNER = [
  ' █████╗ ██████╗  ██████╗ ██╗   ██╗███████╗',
  '██╔══██╗██╔══██╗██╔════╝ ██║   ██║██╔════╝',
  '███████║██████╔╝██║  ███╗██║   ██║███████║',
  '██╔══██║██╔══██╗██║   ██║██║   ██║╚════██║',
  '██║  ██║██║  ██║╚██████╔╝╚██████╔╝███████║',
  '╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚══════╝',
];

export const WORDMARK = '\u2578ARGUS\u257A';

let cachedVersion: string | null = null;

/** Single source of truth: version always matches package.json. */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../../package.json") as { version?: string };
    cachedVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

/** @deprecated Use getVersion() — kept for existing imports. */
export const VERSION = getVersion();
