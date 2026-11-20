// pnpm forwards a literal `--` (e.g. `pnpm test -- --flag`), which jest would treat as the start
// of a test-path pattern. Drop it so flags reach jest as flags.
const args = process.argv.slice(2).filter((a) => a !== '--');
require('jest').run(args);
