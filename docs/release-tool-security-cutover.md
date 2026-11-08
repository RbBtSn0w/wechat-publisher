# Release tool security cutover

Validated locally on 2026-11-09 from main commit
`555a4fde5bf005c717281cab2a4a34ed1713f034`. This patch does not enable
publication or provide production activation evidence.

## Dependency boundary

The only direct dependency range change is Vitest `^1.6.1` to `^4.1.12`.
Official npm metadata for Vitest 3.2.4 still specifies `tinypool: ^1.1.1`,
which cannot accept the advisory's patched 2.1.2 floor. Vitest 4.1.12 removes
that dependency. Its existing test configuration and all existing tests work
without source changes. No incompatible transitive override is introduced.

The lockfile refresh stays within existing release-tool major ranges:

| Package | Before | After |
| --- | --- | --- |
| semantic-release | 25.0.3 | 25.0.9 |
| @semantic-release/github | 12.0.6 | 12.0.10 |
| npm (through @semantic-release/npm) | 11.13.0 | 11.21.2 |
| handlebars | 4.7.9 | 4.7.10 |
| undici, 6.x consumers | 6.25.0 | 6.29.1 |
| undici, 7.x consumer | 7.25.0 | 7.30.2 |
| tar (npm bundle) | 7.5.13 | 7.5.22 |

All production dependency specifications and locked versions remain unchanged.
The existing `flatted: 3.4.2` override remains unchanged. npm's bundled
dependencies are refreshed through their owner instead of overriding them
individually. Registry metadata was read from `https://registry.npmjs.org/`.

## Validation

Both Node 22.22.2 and Node 24.22.2 passed:

```sh
npm ci --no-audit --no-fund
npm run lint
npm test -- --testTimeout=15000
npm run build
node --test test/release-*.test.mjs
```

Results: 259 Vitest tests in 26 files; 78 release regression tests; lint with
zero errors and ten existing warnings. The API/image tests require localhost
listeners: an initial restricted run failed with `listen EPERM`, and the
complete suite then passed with localhost access.

Node 24 also passed packing with `npm pack --ignore-scripts`, strict publint
against the actual tarball, and `npm run test:package -- /absolute/package.tgz`.
The smoke test installs the package in a temporary directory and checks its
entrypoints, CLI dry runs, bundled assets, and portable draft creation.

The public package engine remains `>=22.12.0`. The development release engine
requires Node `^22.14.0 || >=24.10.0`; the two exact tested versions above meet
that requirement. Exact minimum-version execution was not performed. Vite
reports a future native-config-loader compatibility warning for the existing
CommonJS TypeScript config; the current loader succeeds on both tested runtimes.

## Audit result and remaining work

`npm audit --json` reports package-level vulnerability counts, which differ
from Dependabot's advisory-level alert counts:

| Severity | Original lockfile | Patched lockfile |
| --- | --- | --- |
| Critical | 4 | 0 |
| High | 8 | 0 |
| Moderate | 42 | 40 |
| Low | 0 | 0 |

`npm audit --omit=dev --json` reports zero vulnerabilities. The remaining
40 moderate package reports derive from two advisories and their dependent
development packages:

- [Glob cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
  through npm/release-tool dependencies.
- [Minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249),
  through npm/release tooling and TypeScript ESLint 7.

These need upstream-compatible owner upgrades or a separately reviewed
toolchain migration. Forcing glob/minimatch across major ranges or downgrading
semantic-release to satisfy an automated audit suggestion is outside this
patch. Moderate findings remain open; critical/high remediation does not mean
the entire development tree is vulnerability-free.
