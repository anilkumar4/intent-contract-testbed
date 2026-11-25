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
  console.log("PASS VS Code extension activation, contributed commands, walkthrough, and activity-bar container");
} finally {
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function runGit(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}
