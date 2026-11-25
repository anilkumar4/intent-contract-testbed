const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
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
  assert.ok(commands.includes("intentContract.statusClick"), "The status-bar HUD command must be registered.");

  const walkthroughs = extension.packageJSON.contributes.walkthroughs ?? [];
  assert.ok(walkthroughs.some((walkthrough) => walkthrough.id === "intentContractWalkthrough"), "The getting-started walkthrough must be contributed.");

  const activitybar = extension.packageJSON.contributes.viewsContainers?.activitybar ?? [];
  assert.ok(activitybar.some((container) => container.id === "intent-contract-sidebar"), "The Intent Contract activity-bar container must be contributed.");
  const findingsViews = extension.packageJSON.contributes.views?.["intent-contract-sidebar"] ?? [];
  assert.ok(findingsViews.some((view) => view.id === "intentContractFindings"), "The findings tree view must be contributed.");
  const menus = extension.packageJSON.contributes.menus ?? {};
  for (const menu of ["view/title", "view/item/context", "editor/context", "explorer/context"]) {
    assert.ok(Array.isArray(menus[menu]) && menus[menu].length > 0, `The ${menu} actions must be contributed.`);
  }
  const configuration = extension.packageJSON.contributes.configuration.properties;
  for (const setting of [
    "intentContract.autoCheck",
    "intentContract.debounce",
    "intentContract.ignoredPaths",
    "intentContract.severityOverrides",
    "intentContract.enableCodeLens"
  ]) {
    assert.ok(configuration[setting], `The ${setting} setting must be contributed.`);
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "The extension host must open the isolated fixture workspace.");
  const root = folder.uri.fsPath;
  const contractPath = path.join(root, ".intent", "default.yaml");
  const originalContract = await fs.readFile(contractPath, "utf8");
  await vscode.commands.executeCommand("intentContract.createTemplate");
  assert.equal(await fs.readFile(contractPath, "utf8"), originalContract, "Create Template must not overwrite an existing contract.");

  const statePath = path.join(root, ".intent", ".state.json");
  const violationsPath = path.join(root, ".intent", ".violations.md");

  await vscode.commands.executeCommand("intentContract.start");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.activeContract, ".intent/default.yaml", "Starting a contract must persist its active policy.");
  const cleanSummary = await fs.readFile(violationsPath, "utf8");
  assert.match(cleanSummary, /no active violations/i, "The clean baseline should produce a fresh findings summary.");

  const ordersUri = vscode.Uri.file(path.join(root, "src", "orders.js"));
  await vscode.workspace.openTextDocument(ordersUri);
  const orderLenses = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", ordersUri);
  assert.ok(orderLenses.some((lens) => lens.command?.title.includes("Intent: In-Scope")), "An allowed source file should show its in-scope CodeLens.");

  const diagramUri = vscode.Uri.file(path.join(root, "docs", "architecture.mmd"));
  await vscode.workspace.openTextDocument(diagramUri);
  const diagramLenses = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", diagramUri);
  assert.ok(diagramLenses.some((lens) => lens.command?.title.includes("Intent: Read-Only")), "A read-only policy file should show its read-only CodeLens.");

  const ignoredPath = path.join(root, "ignored.md");
  await fs.writeFile(ignoredPath, "This path is ignored by workspace settings.\n");
  await delay(400);
  await vscode.commands.executeCommand("intentContract.recheck");
  assert.deepEqual(vscode.languages.getDiagnostics(vscode.Uri.file(ignoredPath)), [], "Configured ignored paths should not publish diagnostics.");
  assert.doesNotMatch(await fs.readFile(violationsPath, "utf8"), /ignored\.md/, "Ignored paths should be excluded from the findings summary.");

  const notesPath = path.join(root, "notes.md");
  const notesUri = vscode.Uri.file(notesPath);
  await fs.writeFile(notesPath, "This file is outside the contract's modify scope.\n");
  await waitFor("automatic detection of an out-of-scope file", async () => {
    if (vscode.languages.getDiagnostics(notesUri).length === 0) return false;
    const text = await fs.readFile(violationsPath, "utf8");
    return /notes\.md/.test(text);
  });
  const scopeDiagnostics = vscode.languages.getDiagnostics(notesUri);
  assert.ok(scopeDiagnostics.some((diagnostic) =>
    diagnostic.source === "Intent Contract" && diagnostic.severity === vscode.DiagnosticSeverity.Error
  ), "A severity override should elevate the scope warning to an error.");
  const summary = await fs.readFile(violationsPath, "utf8");
  assert.match(summary, /notes\.md/, "The findings summary should identify the out-of-scope file.");

  await vscode.workspace.openTextDocument(notesUri);
  const codeActions = await vscode.commands.executeCommand(
    "vscode.executeCodeActionProvider",
    notesUri,
    new vscode.Range(0, 0, 0, 1),
    vscode.CodeActionKind.QuickFix.value
  );
  const addFileAction = codeActions.find((action) =>
    action.title.includes("Add") && action.title.includes("allowed scope")
  );
  assert.ok(addFileAction?.command, "Scope diagnostics should offer an add-to-scope quick fix command.");
  const notesLenses = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", notesUri);
  assert.ok(notesLenses.some((lens) => lens.command?.title.includes("Out of Scope")), "An out-of-scope file should show its CodeLens status.");

  const probe = `intent-contract-clipboard-probe-${Date.now()}`;
  await vscode.env.clipboard.writeText(probe);
  const clipboardAvailable = (await vscode.env.clipboard.readText()) === probe;
  await vscode.commands.executeCommand("intentContract.copyViolations");
  if (clipboardAvailable) {
    assert.match(await vscode.env.clipboard.readText(), /notes\.md/, "Copy Violations should put actionable findings on the clipboard.");
  } else {
    console.log("NOTE: skipping clipboard content assertion because host clipboard I/O returned empty in this desktop session.");
  }

  await vscode.commands.executeCommand("intentContract.openDiff", {
    id: String(scopeDiagnostics[0].code ?? "scope-notes"),
    detector: "scope",
    file: "notes.md",
    severity: "error",
    message: scopeDiagnostics[0].message,
    evidence: "notes.md"
  });
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  await vscode.commands.executeCommand("intentContract.exportReport");
  const reportDirectory = path.join(root, ".intent", "reports");
  const reports = await fs.readdir(reportDirectory);
  const reportName = reports.find((name) => name.startsWith("compliance-report-") && name.endsWith(".md"));
  assert.ok(reportName, "Export Report should create a compliance report.");
  assert.match(await fs.readFile(path.join(reportDirectory, reportName), "utf8"), /notes\.md/, "The compliance report should contain current findings.");

  await vscode.commands.executeCommand("intentContract.exportArchitectureDrift");
  const driftPath = path.join(root, ".intent", ".architecture-drift.mmd");
  assert.match(await fs.readFile(driftPath, "utf8"), /flowchart LR/, "Architecture export should write a renderable Mermaid diagram.");

  await assertWebviewPanel("intentContract.openDashboard", "Intent Contract: Mission Control", [
    /intent-contract-extension-testbed/,
    /notes\.md/
  ]);
  await assertWebviewPanel("intentContract.visualBuilder", "Intent Contract: Visual Builder", [
    /docs\/architecture\.mmd/
  ]);
  await assertWebviewPanel("intentContract.visualizeArchitecture", "Intent Contract: Architecture Drift Inspector", [
    /docs\/architecture\.mmd/,
    /Orders/,
    /Pricing/
  ]);

  await vscode.commands.executeCommand(
    addFileAction.command.command,
    ...(addFileAction.command.arguments ?? [])
  );
  await waitFor("the updated scope baseline to clear the file finding", () =>
    vscode.languages.getDiagnostics(notesUri).length === 0
  );
  assert.match(await fs.readFile(path.join(root, ".intent", "default.yaml"), "utf8"), /notes\.md/, "Add File to Scope should update the active contract.");

  const orderSource = await fs.readFile(ordersUri.fsPath, "utf8");
  assert.ok(orderSource.includes("return Math.round(order.subtotalCents * 0.08);"), "The sample tax logic should match the host test.");
  await fs.writeFile(ordersUri.fsPath, orderSource.replace(
    "return Math.round(order.subtotalCents * 0.08);",
    "return Math.round(order.subtotalCents * 0.09);"
  ));
  await waitFor("detection of an unlisted symbol", () =>
    vscode.languages.getDiagnostics(ordersUri).some((diagnostic) => /symbol/i.test(diagnostic.message))
  );
  const symbolDiagnostic = vscode.languages.getDiagnostics(ordersUri)
    .find((diagnostic) => /symbol/i.test(diagnostic.message));
  const orderLines = orderSource.split(/\r?\n/);
  const taxDeclarationLine = orderLines.findIndex((line) => line.includes("function calculateTax"));
  assert.ok(taxDeclarationLine >= 0, "The changed tax symbol should have a source declaration.");
  const taxDeclarationColumn = orderLines[taxDeclarationLine].indexOf("calculateTax");
  assert.ok(taxDeclarationColumn >= 0, "The changed tax symbol should have a named declaration.");
  const symbolActionRange = new vscode.Range(
    taxDeclarationLine,
    taxDeclarationColumn,
    symbolDiagnostic.range.end.line,
    symbolDiagnostic.range.end.character
  );
  const symbolActions = await vscode.commands.executeCommand(
    "vscode.executeCodeActionProvider",
    ordersUri,
    symbolActionRange,
    vscode.CodeActionKind.QuickFix.value
  );
  const addSymbolAction = symbolActions.find((action) =>
    action.title.includes("calculateTax") && action.command?.command === "intentContract.addSymbolToScope"
  );
  assert.ok(addSymbolAction?.command, "Symbol diagnostics should offer an add-symbol quick fix command.");
  await vscode.commands.executeCommand(
    addSymbolAction.command.command,
    ...(addSymbolAction.command.arguments ?? [])
  );
  const updatedContract = await fs.readFile(path.join(root, ".intent", "default.yaml"), "utf8");
  assert.match(updatedContract, /calculateTax/, "Add Symbol to Scope should update the active contract.");
  await vscode.commands.executeCommand("intentContract.recheck");
  const remainingSymbolDiagnostics = vscode.languages.getDiagnostics(ordersUri)
    .filter((diagnostic) => /symbol/i.test(diagnostic.message));
  assert.deepEqual(
    remainingSymbolDiagnostics,
    [],
    `The updated symbol baseline should clear the symbol finding: ${remainingSymbolDiagnostics.map((diagnostic) => diagnostic.message).join(" | ")}`
  );

  await vscode.commands.executeCommand("intentContract.markFileReadOnly", notesUri);
  const readOnlyContract = await fs.readFile(contractPath, "utf8");
  const modifySection = readOnlyContract.match(/modify:([\s\S]*?)read_only:/)?.[1] ?? "";
  const readOnlySection = readOnlyContract.match(/read_only:([\s\S]*?)modify_symbols:/)?.[1] ?? "";
  assert.match(readOnlySection, /notes\.md/, "Mark File Read-Only should add notes.md to scope.read_only.");
  assert.doesNotMatch(modifySection, /notes\.md/, "Mark File Read-Only should remove notes.md from scope.modify.");
  assert.ok(vscode.languages.getDiagnostics(notesUri).some((diagnostic) =>
    diagnostic.source === "Intent Contract" &&
    diagnostic.severity === vscode.DiagnosticSeverity.Error &&
    /read-only/i.test(diagnostic.message)
  ), "Mark File Read-Only should synchronize policy and report a read-only violation.");
  const readOnlyNotesLenses = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", notesUri);
  assert.ok(readOnlyNotesLenses.some((lens) => lens.command?.title.includes("Intent: Read-Only")), "After marking read-only, CodeLens should reflect Read-Only status.");

  await vscode.commands.executeCommand("intentContract.stop");
  assert.equal(await exists(statePath), false, "Stopping a session must remove persisted session state.");
  assert.equal(await exists(violationsPath), false, "Stopping a session must remove the generated findings summary.");
  assert.deepEqual(vscode.languages.getDiagnostics(notesUri), [], "Stopping a session must clear editor diagnostics.");
  console.log("PASS extension-host session lifecycle, settings, diagnostics, quick fixes, CodeLens, scope actions, exports, and cleanup");
};

async function waitFor(description, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function assertWebviewPanel(command, expectedTitle, expectedContentPatterns = []) {
  const instance = await vscode.commands.executeCommand(command);
  assert.ok(instance?.panel, `${command} should create a webview panel.`);
  assert.equal(instance.panel.title, expectedTitle, `${command} should open the expected panel.`);
  assert.ok(instance.panel.webview.html.length > 0, `${command} should render webview content.`);
  for (const pattern of expectedContentPatterns) {
    assert.match(instance.panel.webview.html, pattern, `${command} webview HTML should match ${pattern}.`);
  }
  instance.panel.dispose();
}
