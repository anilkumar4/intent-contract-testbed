const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function runRestoredSessionCoverage() {
  const extension = vscode.extensions.getExtension("anilkumar4.intent-contract");
  assert.ok(extension, "Intent Contract must be present in the extension host.");
  await extension.activate();

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "The extension host must open the isolated fixture workspace.");
  const root = folder.uri.fsPath;
  const statePath = path.join(root, ".intent", ".state.json");
  const violationsPath = path.join(root, ".intent", ".violations.md");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.activeContract, ".intent/default.yaml", "Activation should restore the saved contract session.");

  await waitFor("the restored session's findings summary", async () =>
    await exists(violationsPath)
  );
  const restoredSummary = await fs.readFile(violationsPath, "utf8");
  assert.match(restoredSummary, /Intent Contract findings/i, "The restored session should re-check and refresh its findings summary.");

  const outsidePath = path.join(root, "restore-check.md");
  const outsideUri = vscode.Uri.file(outsidePath);
  await fs.writeFile(outsidePath, "Verify that restored sessions continue monitoring the workspace.\n");
  await vscode.commands.executeCommand("intentContract.recheck");
  assert.ok(vscode.languages.getDiagnostics(outsideUri).some((diagnostic) =>
    diagnostic.source === "Intent Contract"
  ), "A restored session should continue reporting workspace changes.");

  await vscode.commands.executeCommand("intentContract.stop");
  assert.equal(await exists(statePath), false, "Stopping the restored session should remove its state.");
  assert.equal(await exists(violationsPath), false, "Stopping the restored session should remove its findings summary.");
  console.log("PASS active-session restoration after reopening the VS Code host");
};

async function waitFor(description, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
