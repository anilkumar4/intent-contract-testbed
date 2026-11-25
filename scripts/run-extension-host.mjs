import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = process.argv[2] ? path.resolve(projectRoot, process.argv[2]) : undefined;

if (!extensionRoot) {
  throw new Error("Usage: node scripts/run-extension-host.mjs <path-to-extension-checkout>");
}

const requireFromExtension = createRequire(path.join(extensionRoot, "package.json"));
const { runTests } = requireFromExtension("@vscode/test-electron");
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "intent-contract-extension-host-"));
const fixture = path.join(projectRoot, "test-workspace");

try {
  await fs.cp(fixture, workspace, { recursive: true });
  const settingsDirectory = path.join(workspace, ".vscode");
  await fs.mkdir(settingsDirectory, { recursive: true });
  await fs.writeFile(path.join(settingsDirectory, "settings.json"), `${JSON.stringify({
    "intentContract.autoCheck": true,
    "intentContract.debounce": 100,
    "intentContract.ignoredPaths": ["ignored.md"],
    "intentContract.severityOverrides": { scope: "error" }
  }, null, 2)}\n`);
  runGit(workspace, ["init", "-q"]);
  runGit(workspace, ["config", "user.name", "Intent Contract Extension Host"]);
  runGit(workspace, ["config", "user.email", "intent-contract-host@example.invalid"]);
  runGit(workspace, ["add", "--all"]);
  runGit(workspace, ["commit", "-m", "Extension host policy baseline"]);

  const exitCode = await runTests({
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: path.join(projectRoot, "test-extension-host", "suite.cjs"),
    launchArgs: [workspace, "--disable-workspace-trust"]
  });
  assert.equal(exitCode, 0, `VS Code extension-host suite exited with status ${exitCode}.`);

  const cliPath = path.join(extensionRoot, "dist", "cli.js");
  const startResult = spawnSync(process.execPath, [cliPath, "start", "default"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(startResult.status, 0, `Could not prepare an active session for the restore test: ${startResult.stderr || startResult.stdout}`);

  const restoreExitCode = await runTests({
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: path.join(projectRoot, "test-extension-host", "restore-suite.cjs"),
    launchArgs: [workspace, "--disable-workspace-trust"]
  });
  assert.equal(restoreExitCode, 0, `VS Code session-restore suite exited with status ${restoreExitCode}.`);
  console.log("PASS VS Code extension-host smoke, lifecycle, session-restore, settings, quick fixes, exports, and cleanup");
} finally {
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function runGit(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}
