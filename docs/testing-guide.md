# Intent Contract Testbed: Testing and Run Guide

This repository is a test harness, not the extension source. It checks out the public extension repository into a separate directory in CI and tests it without changing that repository.

## What you need

- VS Code
- Git
- Node.js 22.12 or newer
- The extension source repository: `https://github.com/anilkumar4/intent-contract-vs-ext`
- This testbed: `https://github.com/anilkumar4/intent-contract-testbed`

## Run the extension interactively

### 1. Prepare the extension

Clone both repositories next to one another, then compile the extension:

```powershell
git clone https://github.com/anilkumar4/intent-contract-vs-ext.git
git clone https://github.com/anilkumar4/intent-contract-testbed.git
Set-Location .\intent-contract-vs-ext
npm ci
npm run compile
code .
```

In the extension source window, press **F5** and select **Run Intent Contract Extension**. VS Code opens an Extension Development Host window running the locally compiled extension.

### 2. Prepare a separate Git test workspace

The sample is [test-workspace](../test-workspace). For interactive testing, use a temporary copy so your experiments do not dirty the testbed checkout. In a PowerShell terminal opened at the testbed root:

```powershell
$fixture = Join-Path $env:TEMP ("intent-contract-manual-" + [guid]::NewGuid().ToString("N"))
Copy-Item -Path .\test-workspace -Destination $fixture -Recurse
Set-Location $fixture
git init
git config user.name "Intent Contract Manual Test"
git config user.email "intent-contract-manual@example.invalid"
git add --all
git commit -m "Create clean test baseline"
```

In the Extension Development Host, choose **File > Open Folder** and open the new `$fixture` directory. It contains `.intent/default.yaml` and must be its own Git repository: otherwise Git would find the testbed's parent repository instead.

### 3. Start a contract session and check changes

In the Extension Development Host:

1. Open the Command Palette with **Ctrl+Shift+P**.
2. Run **Intent Contract: Start Contract**. The sample has one contract, so it should be selected automatically. This captures the current Git tree as the baseline.
3. Make one of the test changes below.
4. Run **Intent Contract: Re-check Now**, or save the file and let automatic checking run.
5. Inspect editor diagnostics and the **Intent Contract Findings** view in the activity bar.

The test contract allows edits under `src/**` and `test/**`, and only allows these named symbols: `runIntentChecks`, `evaluateIntent`, and `hasRequiredIntent`. It treats the contract, architecture diagram, package metadata, and `.github` files as read-only.

## Where findings and generated files go

Paths are relative to the **opened Git workspace root**, not the extension installation:

| File or directory | Purpose |
|---|---|
| `.intent/.violations.md` | Created or refreshed by a contract check. Contains active, unwaived findings and remediation text for the coding agent. In the temporary manual workspace, this is `$fixture\.intent\.violations.md`. |
| `.intent/.state.json` | Active session and captured baseline metadata. |
| `.intent/waivers.json` | Reasons and timestamps for waived findings, when the contract allows exceptions. |
| `.intent/.architecture-drift.mmd` | Exported architecture diagram with detected violations. |
| `.intent/reports/` | Exported compliance reports and related artifacts. |

These are workspace files, not files under the extension's install directory. The sample `.intent/.gitignore` excludes generated session files. **Intent Contract: Stop Contract** ends the active session and removes `.intent/.violations.md`; it does not revert your source changes. In the temporary workspace, use `git restore .` to return tracked files to the baseline. Remove any untracked test files manually, or use a fresh temporary copy for the next scenario.

## Manual feature scenarios

Start each scenario from a clean baseline, or restore the temporary workspace before trying the next one.

| Change in the temporary workspace | Expected result |
|---|---|
| Change an allowed function in `src/extension.js` | No scope or symbol-scope finding. |
| Add `notes.md` at the workspace root | `scope` warning: outside `scope.modify`. |
| Edit `docs/architecture.mmd` or `.intent/default.yaml` | `scope` error: read-only/policy integrity violation. |
| Add an unlisted function to `src/extension.js` | `symbol_scope` finding. |
| Add a dependency to `package.json` | `dependencies` finding; the manifest is also read-only/high-risk. |
| Edit `.github/workflows/ci.yml` | `high_risk_files` and scope finding. |
| Change `.toEqual([])` to `.toBeTruthy()` in `test/contract.test.js` | `test_weakening` finding. |
| Remove the assertion from a test in `test/contract.test.js` | `tautological_tests` finding. |
| Import `./extension.js` from `src/contract.js` | `architecture_drift` finding: the Contract-to-Extension edge is not allowed. |
| Edit `.github/workflows/approved.yml` | Scope finding, but no high-risk finding because the policy explicitly excludes this path. |

Findings can be checked in the editor, the Findings view, and `.intent/.violations.md`. The message text and severity are more useful than expecting one finding per changed file: a single change can trigger multiple detectors.

## Run automated tests locally

### Extension source suite

From the extension repository:

```powershell
npm ci
npm run typecheck
npm test
npm run compile
npm run test:smoke
```

`npm test` runs the extension's contract, detector, Git, CLI, MCP, configuration, state, and UI regression tests. `npm run test:smoke` launches the VS Code extension host and checks extension startup and command registration.

### Testbed suite

From the testbed root, with the extension repository cloned alongside it:

```powershell
Set-Location .\test-workspace
npm test
Set-Location ..
node .\scripts\run-policy-scenarios.mjs ..\intent-contract-vs-ext\dist\cli.js
node .\scripts\run-extension-host.mjs ..\intent-contract-vs-ext
```

The policy scenario runner creates and deletes disposable Git repositories under the system temporary directory. It verifies clean and allowed changes, every contract detector, custom high-risk include/exclude behavior, policy tampering, and invalid contracts through the compiled CLI. The extension-host runner copies the sample workspace to a temporary Git repository and checks activation plus every contributed command, the walkthrough, and the activity-bar container.

The GitHub Actions workflow runs the extension typecheck, unit/integration suite, compile, sample tests, and policy scenarios on Linux, Windows, and macOS with Node.js 22 and 24. A dependent Linux job runs both extension-host smoke suites and packages a VSIX artifact.

## Test coverage map

| Feature area | Automated coverage |
|---|---|
| Contract parsing, validation, and template creation | `test/contract.test.ts` in the extension repository; invalid-policy CLI scenario in this testbed |
| Scope, read-only policy, symbol scope, dependencies, high-risk files, test weakening, tautologies, architecture drift | Extension tests under `test/detectors/`; black-box scenarios in `scripts/run-policy-scenarios.mjs` |
| Git snapshots, staged/index checks, revision checks, and revert behavior | Extension tests under `test/git/` and `test/cli/` |
| CLI, compliance reports, and CI output | Extension tests under `test/cli/` and `test/state/` |
| MCP protocol and tools | Extension tests under `test/mcp/` |
| Agent configuration, synchronization, and Git hooks | Extension tests under `test/config/` |
| Waivers, report generation, and UI helper regressions | Extension tests under `test/state/` and `test/ui/` |
| Extension activation, contributed commands, walkthrough, and activity-bar container | Upstream smoke test plus `test-extension-host/suite.cjs` |

The extension-host checks verify activation and contribution registration; they do not simulate every click path through interactive webviews. The suite is feature-focused and does not claim 100% statement/branch coverage.

## Troubleshooting

- **“Open a Git repository folder”**: open the temporary copy created above and confirm `git status` works there.
- **No contract is found**: open the copied workspace root, which must contain `.intent/default.yaml`.
- **No violation file appears**: start a contract and run **Intent Contract: Re-check Now**. The file is written under the opened workspace's `.intent/` directory when that directory is writable.
- **VS Code host does not launch**: confirm the extension compiles and that the installed VS Code supports the `extensionHost` debug configuration. The automated test runners download VS Code if needed.
