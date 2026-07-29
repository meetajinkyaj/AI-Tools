/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * The real package throws on import by design: that is how it makes a Next
 * build fail if server code is ever pulled into a client bundle. There is no
 * client bundle in a unit test, so importing it there fails for no reason and
 * makes every module carrying the guard untestable.
 *
 * Aliasing it here (see vitest.config.ts) keeps the guard fully in force where
 * it matters — Next resolves the real package at build time — while letting the
 * tests import the modules it protects. The alternative was removing
 * `server-only` from files that genuinely need it, which would trade a real
 * safety net for a test runner's convenience.
 */
export {};
