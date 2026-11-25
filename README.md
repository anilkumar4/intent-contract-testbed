# Intent Contract Extension Testbed

This standalone project is an isolated validation workspace for the Intent Contract VS Code extension. It does not modify or copy files into the extension project.

## What is included

- `test-workspace/.intent/default.yaml` is a strict sample policy exercising editable and read-only scope, symbol-level scope, custom high-risk paths, architecture drift, dependency changes, test weakening, and high-risk file checks.
- `test-workspace/` is a runnable Node.js fixture repository with source imports, tests, package metadata, and an architecture diagram matching the policy.
- `scripts/run-policy-scenarios.mjs` creates disposable Git repositories and exercises clean and permitted changes, out-of-scope and read-only edits, contract tampering, symbol scope, dependencies, custom and default high-risk paths, test weakening, tautological tests, architecture drift, and invalid contracts through the compiled CLI.
- `test-extension-host/` checks activation, registration of every contributed command, the getting-started walkthrough, and the activity-bar container in a real VS Code extension host.
- `.github/workflows/ci.yml` checks out the public extension repository separately, runs its typecheck, unit/integration tests, and compile across Linux, Windows, and macOS with Node.js 22 and 24, then runs the policy scenarios, both extension-host smoke suites, packages a VSIX, and uploads it as an artifact.

The workflow only reads the extension checkout and executes its existing commands. Its test fixture is initialized as a temporary Git repository during the run.

## Running the workflow

Push this folder as its own GitHub repository, or copy it into a new repository, then run **Intent Contract Testbed CI** from the Actions tab. The workflow downloads the VS Code test runtime as needed and uploads the packaged VSIX as a 14-day artifact.

## Try the sample workspace locally

Run `npm test` from `test-workspace/` to verify its example behavior. Open `test-workspace/` in VS Code with Intent Contract installed. The `.intent/default.yaml` policy restricts changes to `src/**` and `test/**`; keep the architecture diagram, contract, and project configuration read-only.

The architecture map is deliberately small and explicit. Add edges to `docs/architecture.mmd` only when the project owner approves the dependency, then capture a fresh contract baseline before checking changes.

See the [testing and run guide](docs/testing-guide.md) for VS Code Extension Development Host setup, manual feature scenarios, automated test commands, and generated-file locations. Findings are written to `.intent/.violations.md` under the opened test workspace.
