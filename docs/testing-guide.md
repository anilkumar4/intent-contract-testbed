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

The fixture includes an order-pricing flow across `src/orders.js` and `src/pricing.js`, with behavior tests in `test/orders.test.js`. The test contract allows edits under `src/**` and `test/**`, and constrains named symbols; `calculateTax` is intentionally not allowed initially so you can test the Add Symbol to Scope workflow. It treats the contract, architecture diagram, package metadata, and `.github` files as read-only.

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
| Change an allowed function in `src/orders.js` or `src/extension.js` | No scope or symbol-scope finding. |
| Change `calculateTax` in `src/orders.js` from an 8% to a 9% calculation | `symbol_scope` finding; use **Add Symbol to Scope** to approve it and update the active baseline. |
| Keep the `Orders --> Pricing` dependency in `orders.js` | The architecture edge is permitted. |
| Add an import from `src/pricing.js` to `src/orders.js` | `architecture_drift` finding: this reverses the approved dependency direction. |
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

To exercise the extension's scope actions, add `notes.md`, run **Intent Contract: Re-check Now**, and use the diagnostic quick fix or **Add File to Active Scope (Modify)**. Then choose **Mark File as Read-Only** and re-check. The testbed's extension-host suite covers this active-baseline synchronization without changing your checkout.

### Interactive flows to verify before release

The host suite opens webviews and checks their commands, but does not automate every interactive prompt or button. In a disposable Git workspace, also verify:

1. **Template and Visual Contract Builder:** create a contract in an empty `.intent/`; confirm a second create does not overwrite it; create another contract with the builder, inspect its YAML, and start it.
2. **Dashboard and Architecture Inspector:** inspect scorecards/findings, re-check, copy corrective prompts, revert out-of-scope files, inspect architecture edges, jump to source lines, update scope, and open the policy diagram.
3. **Finding actions:** open a finding diff, revert both a changed tracked file and an added file (including the confirmation), and verify the working tree matches the baseline.
4. **Waivers:** with `allow_exceptions: true`, choose a reason, enter a non-empty justification, select a TTL, and verify the finding is grouped as waived and saved in `.intent/waivers.json`. Repeat with exceptions disabled and confirm it is refused.
5. **Agent setup and hooks:** configure only the Antigravity integration and inspect the generated `.agents/` files; use the extension UI to install pre-commit/pre-push hooks in a disposable repository. Upstream integration tests execute the hooks against a local bare remote and verify violating commits/pushes are blocked. Never use a real remote for this test.
6. **Status bar, walkthrough, and guide:** open each entry point and verify its navigation/actions; use **Report an Issue** only to inspect the prepared URL—do not submit it.
7. **MCP tools:** connect a local MCP client using the generated configuration and exercise contract retrieval, verification, remediation, reversion, self-healing, and session start against the disposable workspace.

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
node .\scripts\run-mcp-scenarios.mjs ..\intent-contract-vs-ext\dist\mcp-server.js
node .\scripts\run-extension-host.mjs ..\intent-contract-vs-ext
```

The policy scenario runner creates and deletes disposable Git repositories under the system temporary directory. It verifies clean and allowed changes (with strict zero-finding checks), every contract detector, test-weakening variants (matcher downgrade, skipped tests, deleted test blocks, trivial assertions), reversed architecture edges, custom high-risk include/exclude behavior, policy tampering, waivers (`allow_exceptions: true` with active/expired TTLs and `allow_exceptions: false`), invalid contracts, CLI session subcommands (`start`, `check --index`, `check --revision`, `check --format github`, `revert`, `report --badge --pr-comment`, `stop`), and live Git `pre-commit` hook blocking through the compiled CLI. The MCP scenario runner exercises `dist/mcp-server.js` over stdio JSON-RPC (`initialize`, `tools/list`, `start_intent_contract`, `get_active_contract`, `verify_intent_contract`, `get_remediation_instructions`, `revert_out_of_scope_files`, and `self_heal_contract`). The extension-host runner copies the sample workspace to a temporary Git repository and exercises session start/re-check/stop and restoration after reopening VS Code, automatic checks, ignored paths, severity overrides, findings/diagnostics, CodeLens, quick fixes, scope synchronization, template preservation, diff viewing, clipboard/report/architecture exports, webview content, and generated-file cleanup.

The GitHub Actions workflow runs the extension typecheck, unit/integration suite, compile, sample tests, policy/CLI scenarios, and MCP scenarios on Linux, Windows, and macOS with Node.js 22 and 24. A dependent Linux job runs both extension-host smoke suites and packages a VSIX artifact.

## Test coverage map

| Feature area | Automated coverage |
|---|---|
| Contract parsing, validation, template creation | Extension tests in `test/contract.test.ts`; invalid-policy CLI scenario; host `createTemplate` non-overwrite check. Interactive builder flows remain manual. |
| Scope, symbols, dependencies, high-risk paths, test weakening, tautologies, architecture | Extension tests under `test/detectors/`; black-box CLI scenarios (including reversed edges, skipped/deleted/trivial tests); realistic order-pricing fixture. |
| Language and manifest variants | Upstream detector fixtures cover Python/Go/Java/Kotlin/C# architecture imports, JavaScript/Python/Go/Java test weakening, and Node/Python/Go/Rust/Java/.NET/Ruby dependency manifests; the executable testbed app itself is JavaScript. |
| Session lifecycle and generated findings file | VS Code host suites start, check, stop, and restore a contract across host runs; assert `.intent/.state.json` and `.intent/.violations.md` creation/removal; CLI lifecycle scenario covers `start`/`check`/`stop`. |
| Automatic checking, ignored paths, severity overrides, diagnostics | VS Code host suite verifies actual workspace behavior; upstream detector tests cover rule results. |
| CodeLens, quick fixes, add-file/add-symbol/read-only scope actions | VS Code host suite requests the symbol quick fix on the actual `symbol_scope` diagnostic range and verifies `calculateTax` is added; also covers `read_only` YAML sync and CodeLens transitions. Upstream `test/ui/` includes the symbol-extraction regression. |
| Compliance report and architecture export | VS Code host suite asserts report contents and renderable Mermaid output; CLI `report` scenario verifies `--output`, `--badge`, and `--pr-comment`. |
| Git snapshots, staged/index checks, revisions, revert, and hooks | Extension integration tests under `test/git/`, `test/cli/`, and `test/config/`; snapshot tests explicitly cover same-timestamp, same-length edits (the racy-Git regression). Testbed CLI scenarios exercise a same-length source edit plus `--index`, `--revision`, `revert`, and `hook install` pre-commit blocking. |
| MCP protocol/tools and agent configuration/synchronization | Extension tests under `test/mcp/` and `test/config/`; testbed `run-mcp-scenarios.mjs` exercises live stdio JSON-RPC against `test-workspace`. |
| Waivers and finding UI helpers | Extension tests under `test/state/` and `test/ui/`; testbed CLI scenarios verify active, expired, and `allow_exceptions: false` waivers. Interactive justification/TTL prompts remain manual. |
| Extension activation, command contributions, walkthrough, activity bar | Upstream smoke test and testbed extension-host suite. |
| Dashboard, Visual Builder, Architecture Inspector | Testbed host verifies each webview opens and renders contract/diagram/finding content; interactive webview message/button flows remain manual. |

### Command-by-command status

| Commands | Automated coverage and remaining manual checks |
|---|---|
| `start`, `recheck`, `stop` | Host E2E verifies baseline/session state, clean and violating checks, findings output, and stop cleanup. |
| `copyViolations`, `exportReport`, `exportArchitectureDrift` | Host E2E verifies clipboard text and generated report/diagram contents. |
| `addFileToScope`, `addSymbolToScope`, `markFileReadOnly` | Host E2E verifies each command updates the active policy baseline and findings. |
| `openDashboard`, `visualBuilder`, `visualizeArchitecture` | Host E2E verifies the webview panels open; their interactive controls still need manual verification. |
| `createTemplate`, `openDiff`, `openGuide`, `openWalkthrough`, `revertFile`, `waiveFinding`, `configureAgents`, `reportIssue`, `statusClick` | Registration is asserted in the host. Related contract, Git, waiver, and agent logic has upstream tests where applicable; prompt-driven flows, confirmation dialogs, external issue opening, and the status HUD remain manual. |

The CI matrix runs the extension's typecheck, unit/integration tests, compile, sample tests, and CLI scenarios on Linux, Windows, and macOS with Node.js 22 and 24. VS Code-host and VSIX packaging checks run on Linux with Node.js 22.

The host suite verifies real extension state and generated outputs but does not simulate every UI prompt, waiver TTL choice, webview button, or real Git pre-commit/pre-push invocation. Those flows have upstream unit/integration coverage where available and should be manually exercised before a release. This is broad feature-focused coverage, not 100% statement/branch coverage or a guarantee that no future review could identify additional cases.

## Troubleshooting

- **“Open a Git repository folder”**: open the temporary copy created above and confirm `git status` works there.
- **No contract is found**: open the copied workspace root, which must contain `.intent/default.yaml`.
- **No violation file appears**: start a contract and run **Intent Contract: Re-check Now**. The file is written under the opened workspace's `.intent/` directory when that directory is writable.
- **VS Code host does not launch**: confirm the extension compiles and that the installed VS Code supports the `extensionHost` debug configuration. The automated test runners download VS Code if needed.
