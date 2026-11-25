const assert = require("node:assert/strict");
const vscode = require("vscode");

exports.run = async function runExtensionHostCoverage() {
  const extension = vscode.extensions.getExtension("anilkumar4.intent-contract");
  assert.ok(extension, "Intent Contract must be present in the extension host.");

  await extension.activate();
  assert.equal(extension.isActive, true, "Intent Contract must activate.");

  const commands = await vscode.commands.getCommands(true);
  const contributedCommands = extension.packageJSON.contributes.commands.map((item) => item.command);
  assert.ok(contributedCommands.length > 0, "The extension manifest should contribute commands.");

  for (const command of contributedCommands) {
    assert.ok(commands.includes(command), `Contributed command must be registered: ${command}`);
  }

  const walkthroughs = extension.packageJSON.contributes.walkthroughs ?? [];
  assert.ok(walkthroughs.some((walkthrough) => walkthrough.id === "intentContractWalkthrough"), "The getting-started walkthrough must be contributed.");

  const activitybar = extension.packageJSON.contributes.viewsContainers?.activitybar ?? [];
  assert.ok(activitybar.some((container) => container.id === "intent-contract-sidebar"), "The Intent Contract activity-bar container must be contributed.");
};
