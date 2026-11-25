import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(projectRoot, "test-workspace");
const mcpPath = process.argv[2] ? path.resolve(projectRoot, process.argv[2]) : undefined;

if (!mcpPath) {
  throw new Error("Usage: node scripts/run-mcp-scenarios.mjs <path-to-compiled-mcp-server.js>");
}

const generatedIntentEntries = new Set([".state.json", ".violations.md", "waivers.json", ".architecture-drift.mmd", "reports"]);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-contract-mcp-"));
const repo = path.join(tempRoot, "workspace");

try {
  await fs.cp(fixtureRoot, repo, {
    recursive: true,
    filter: (sourcePath) => {
      const rel = path.relative(fixtureRoot, sourcePath).replace(/\\/g, "/");
      if (rel.startsWith(".intent/")) {
        const entry = rel.slice(".intent/".length).split("/")[0];
        if (generatedIntentEntries.has(entry)) return false;
      }
      return true;
    }
  });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Intent Contract MCP"]);
  git(repo, ["config", "user.email", "intent-contract-mcp@example.invalid"]);
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "-m", "MCP scenario baseline"]);

  const client = startMcpClient(mcpPath, repo);
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "intent-contract-testbed", version: "1.0.0" }
    });
    assert.equal(init.serverInfo.name, "intent-contract");
    assert.equal(init.protocolVersion, "2024-11-05");
    client.notify("notifications/initialized", {});
    console.log("PASS MCP initialize");

    const listed = await client.request("tools/list", {});
    const toolNames = new Set(listed.tools.map((tool) => tool.name));
    for (const expectedTool of [
      "get_active_contract",
      "verify_intent_contract",
      "revert_out_of_scope_files",
      "start_intent_contract",
      "get_remediation_instructions",
      "self_heal_contract"
    ]) {
      assert.ok(toolNames.has(expectedTool), `Expected MCP tool "${expectedTool}" to be listed.`);
    }
    console.log("PASS MCP tools/list");

    const started = await client.callTool("start_intent_contract", { name: "default" });
    assert.equal(started.isError, false);
    assert.equal(started.structuredContent.started, true);
    assert.equal(started.structuredContent.name, "intent-contract-extension-testbed");
    console.log("PASS MCP start_intent_contract");

    const restartGuard = await client.callTool("start_intent_contract", { name: "default" });
    assert.equal(restartGuard.isError, true, "Re-starting an active session via MCP must be rejected.");
    console.log("PASS MCP active-session restart guard");

    const active = await client.callTool("get_active_contract", {});
    assert.equal(active.isError, false);
    assert.equal(active.structuredContent.name, "intent-contract-extension-testbed");
    assert.deepEqual(active.structuredContent.modify, ["src/**", "test/**"]);
    assert.ok(active.structuredContent.forbid.includes("architecture_drift"));
    console.log("PASS MCP get_active_contract");

    const cleanCheck = await client.callTool("verify_intent_contract", {});
    assert.equal(cleanCheck.structuredContent.passed, true);
    assert.equal(cleanCheck.structuredContent.findings.length, 0);
    console.log("PASS MCP verify_intent_contract clean baseline");

    await fs.writeFile(path.join(repo, "notes.md"), "Out-of-scope file created during MCP check.\n");
    const ordersPath = path.join(repo, "src", "orders.js");
    const originalOrders = await fs.readFile(ordersPath, "utf8");
    await fs.writeFile(ordersPath, originalOrders.replace("0.08", "0.09"));

    const failedCheck = await client.callTool("verify_intent_contract", {});
    assert.equal(failedCheck.structuredContent.passed, false);
    assert.equal(failedCheck.structuredContent.errorCount, 1);
    assert.equal(failedCheck.structuredContent.warningCount, 1);
    console.log("PASS MCP verify_intent_contract detects violations");

    const remediation = await client.callTool("get_remediation_instructions", {});
    assert.equal(remediation.structuredContent.passed, false);
    assert.equal(remediation.structuredContent.violationsCount, 2);
    assert.match(remediation.structuredContent.remediationInstructions, /calculateTax|orders\.js/);
    assert.match(remediation.structuredContent.remediationInstructions, /notes\.md/);
    console.log("PASS MCP get_remediation_instructions");

    const partialRevert = await client.callTool("revert_out_of_scope_files", { files: ["notes.md"] });
    assert.equal(partialRevert.structuredContent.count, 1);
    assert.deepEqual(partialRevert.structuredContent.reverted, ["notes.md"]);
    await assert.rejects(fs.access(path.join(repo, "notes.md")));
    console.log("PASS MCP revert_out_of_scope_files");

    const healed = await client.callTool("self_heal_contract", {});
    assert.equal(healed.structuredContent.healed, true);
    assert.equal(healed.structuredContent.remainingViolations, 0);
    assert.ok(healed.structuredContent.revertedFiles.includes("src/orders.js"));
    assert.equal(
      (await fs.readFile(ordersPath, "utf8")).replace(/\r\n/g, "\n"),
      originalOrders.replace(/\r\n/g, "\n")
    );
    console.log("PASS MCP self_heal_contract");
  } finally {
    await client.close();
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function startMcpClient(serverScript, cwd) {
  const child = spawn(process.execPath, [serverScript, "--workspace", cwd], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let nextId = 1;
  let stderr = "";
  const pending = new Map();

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
      else resolve(message.result);
    }
  });

  child.on("exit", (code) => {
    for (const { reject } of pending.values()) {
      reject(new Error(`MCP server exited unexpectedly with code ${code}: ${stderr}`));
    }
    pending.clear();
  });

  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for MCP response to ${method}. stderr: ${stderr}`));
        }, 15000);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (err) => { clearTimeout(timer); reject(err); }
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    async callTool(name, args) {
      return this.request("tools/call", { name, arguments: args });
    },
    async close() {
      rl.close();
      child.stdin.end();
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}
