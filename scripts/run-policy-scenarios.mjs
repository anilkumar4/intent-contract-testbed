import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(projectRoot, "test-workspace");
const cliPath = process.argv[2] ? path.resolve(projectRoot, process.argv[2]) : undefined;

if (!cliPath) {
  throw new Error("Usage: node scripts/run-policy-scenarios.mjs <path-to-compiled-cli.js>");
}

const generatedIntentEntries = new Set([".state.json", ".violations.md", "waivers.json", ".architecture-drift.mmd", "reports"]);

const scenarios = [
  {
    name: "clean baseline passes",
    expected: []
  },
  {
    name: "permitted symbol edit passes",
    expected: [],
    change: async (root) => {
      await replaceOnce(root, "src/extension.js",
        "return hasRequiredIntent(contract) ? [] : evaluateIntent(contract);",
        "if (hasRequiredIntent(contract)) return [];\n  return evaluateIntent(contract);"
      );
    }
  },
  {
    name: "permitted module dependency remains valid",
    expected: [],
    change: async (root) => {
      await replaceOnce(root, "src/orders.js",
        "totalCents: applyDiscount(subtotalCents, discountPercent)",
        "totalCents: applyDiscount(subtotalCents, (discountPercent))"
      );
    }
  },
  {
    name: "out-of-scope file is reported",
    exitCode: 0,
    expected: ["scope"],
    expectedRules: [{ detector: "scope", rule: "outside_modify", file: "notes.md", severity: "warning" }],
    change: async (root) => fs.writeFile(path.join(root, "notes.md"), "Outside the declared edit scope.\n")
  },
  {
    name: "read-only architecture policy is protected",
    expected: ["scope"],
    expectedRules: [{ detector: "scope", rule: "read_only", file: "docs/architecture.mmd", severity: "error" }],
    change: async (root) => fs.appendFile(path.join(root, "docs", "architecture.mmd"), "\n  Extension --> Tests\n")
  },
  {
    name: "contract policy tampering is reported",
    expected: ["scope"],
    expectedRules: [{ detector: "scope", rule: "read_only", file: ".intent/default.yaml", severity: "error" }],
    change: async (root) => fs.appendFile(path.join(root, ".intent", "default.yaml"), "\n# tampering attempt\n")
  },
  {
    name: "unlisted symbol edit is reported",
    expected: ["symbol_scope"],
    expectedRules: [{ detector: "symbol_scope", rule: "symbol_not_allowed", file: "src/extension.js", severity: "error" }],
    change: async (root) => fs.appendFile(path.join(root, "src", "extension.js"), "\nexport function unlistedHelper() { return false; }\n")
  },
  {
    name: "new dependency is reported",
    expected: ["dependencies"],
    expectedRules: [{ detector: "dependencies", rule: "dependency_changed", file: "package.json", severity: "error" }],
    change: async (root) => {
      const file = path.join(root, "package.json");
      const manifest = JSON.parse(await fs.readFile(file, "utf8"));
      manifest.dependencies = { "unapproved-fixture-package": "1.0.0" };
      await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  },
  {
    name: "custom high-risk include is reported",
    expected: ["high_risk_files"],
    expectedRules: [{ detector: "high_risk_files", rule: "custom_high_risk", file: "package.json", severity: "error" }],
    change: async (root) => {
      const file = path.join(root, "package.json");
      const manifest = JSON.parse(await fs.readFile(file, "utf8"));
      manifest.description = "Changed high-risk package manifest";
      await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  },
  {
    name: "custom high-risk exclusion is honored",
    expected: ["scope"],
    expectedRules: [{ detector: "scope", rule: "read_only", file: ".github/workflows/approved.yml", severity: "error" }],
    forbidden: ["high_risk_files"],
    change: async (root) => fs.appendFile(path.join(root, ".github", "workflows", "approved.yml"), "\n# explicitly excluded from high-risk findings\n")
  },
  {
    name: "custom high-risk CI workflow include is reported",
    expected: ["high_risk_files"],
    expectedRules: [{ detector: "high_risk_files", rule: "custom_high_risk", file: ".github/workflows/ci.yml", severity: "error" }],
    change: async (root) => fs.appendFile(path.join(root, ".github", "workflows", "ci.yml"), "\n# changed workflow\n")
  },
  {
    name: "default high-risk CODEOWNERS path is reported",
    expected: ["high_risk_files"],
    expectedRules: [{ detector: "high_risk_files", rule: "codeowners", file: ".github/CODEOWNERS", severity: "error" }],
    change: async (root) => fs.writeFile(path.join(root, ".github", "CODEOWNERS"), "* @anilkumar4\n")
  },
  {
    name: "test matcher downgrade is reported",
    expected: ["test_weakening"],
    expectedRules: [{ detector: "test_weakening", rule: "matcher_downgrade", file: "test/contract.test.js", severity: "error" }],
    change: async (root) => {
      await replaceOnce(root, "test/contract.test.js", ".toEqual([])", ".toBeTruthy()");
    }
  },
  {
    name: "skipped test is reported",
    expected: ["test_weakening"],
    expectedRules: [{ detector: "test_weakening", rule: "disabled_test", file: "test/orders.test.js", severity: "error" }],
    change: async (root) => {
      await replaceOnce(root, "test/orders.test.js", 'test("calculates tax from the pre-discount subtotal"', 'test.skip("calculates tax from the pre-discount subtotal"');
    }
  },
  {
    name: "deleted test block is reported",
    expected: ["test_weakening"],
    expectedRules: [{ detector: "test_weakening", rule: "net_test_block_loss", file: "test/orders.test.js", severity: "error" }],
    change: async (root) => {
      await replaceOnce(
        root,
        "test/orders.test.js",
        'test("calculates tax from the pre-discount subtotal", () => {\n  assert.equal(calculateTax({ subtotalCents: 1100 }), 88);\n});',
        ""
      );
    }
  },
  {
    name: "trivial assertion is reported",
    expected: ["test_weakening"],
    expectedRules: [{ detector: "test_weakening", rule: "trivial_assertion", file: "test/contract.test.js", severity: "error" }],
    change: async (root) => {
      await replaceOnce(root, "test/contract.test.js", "expect(runIntentChecks(contract)).toEqual([]);", "expect(true).toBeTruthy();");
    }
  },
  {
    name: "assertion-free test is reported",
    expected: ["tautological_tests"],
    expectedRules: [{ detector: "tautological_tests", rule: "assertion_free_test", file: "test/contract.test.js", severity: "error" }],
    change: async (root) => {
      await replaceOnce(
        root,
        "test/contract.test.js",
        "expect(runIntentChecks(contract)).toEqual([]);",
        "runIntentChecks(contract);"
      );
    }
  },
  {
    name: "unlisted architecture edge is reported",
    expected: ["architecture_drift"],
    expectedRules: [{ detector: "architecture_drift", rule: "unlisted_edge", file: "src/contract.js", severity: "error" }],
    change: async (root) => fs.appendFile(path.join(root, "src", "contract.js"), '\nimport { runIntentChecks } from "./extension.js";\nvoid runIntentChecks;\n')
  },
  {
    name: "reversed architecture edge is reported",
    expected: ["architecture_drift"],
    expectedRules: [{ detector: "architecture_drift", rule: "unlisted_edge", file: "src/pricing.js", severity: "error" }],
    change: async (root) => fs.appendFile(path.join(root, "src", "pricing.js"), '\nimport { createOrder } from "./orders.js";\nvoid createOrder;\n')
  },
  {
    name: "invalid contract is rejected",
    exitCode: 2,
    beforeCommit: async (root) => fs.writeFile(path.join(root, ".intent", "default.yaml"), "name: invalid\nintent: invalid\nunknown_key: true\n")
  }
];

for (const scenario of scenarios) {
  await withDisposableRepo(async (repo) => {
    if (scenario.beforeCommit) await scenario.beforeCommit(repo);
    commitBaseline(repo, "Scenario policy baseline");

    if (scenario.change) await scenario.change(repo);
    const result = runCli(repo, ["check", "--base", "HEAD", "--contract", ".intent/default.yaml", "--format", "json"]);

    const expectedExitCode = scenario.exitCode ?? (scenario.expected.length > 0 ? 1 : 0);
    assert.equal(result.status, expectedExitCode, `${scenario.name}: ${result.stderr || result.stdout}`);

    if (scenario.exitCode === 2) {
      assert.match(`${result.stdout}\n${result.stderr}`, /default\.yaml|contract/i, `${scenario.name}: expected a contract validation error`);
    } else {
      const report = JSON.parse(result.stdout);
      if (scenario.expected.length === 0) {
        assert.equal(report.findings.length, 0, `${scenario.name}: expected zero findings, got ${JSON.stringify(report.findings)}`);
      }
      const detectors = new Set(report.findings.map((finding) => finding.detector));
      for (const detector of scenario.expected) {
        assert.ok(detectors.has(detector), `${scenario.name}: expected detector "${detector}", got ${[...detectors].join(", ") || "no findings"}`);
      }
      for (const expectedRule of scenario.expectedRules ?? []) {
        assert.ok(
          report.findings.some((finding) =>
            finding.detector === expectedRule.detector &&
            (!expectedRule.rule || finding.rule === expectedRule.rule) &&
            (!expectedRule.file || finding.file === expectedRule.file) &&
            (!expectedRule.severity || finding.severity === expectedRule.severity)
          ),
          `${scenario.name}: expected finding matching ${JSON.stringify(expectedRule)}, got ${JSON.stringify(report.findings)}`
        );
      }
      for (const detector of scenario.forbidden ?? []) {
        assert.ok(!detectors.has(detector), `${scenario.name}: detector "${detector}" should have been excluded`);
      }
    }

    console.log(`PASS ${scenario.name}`);
  });
}

// Waiver enforcement scenarios (allow_exceptions: false, active waiver, expired waiver)
await withDisposableRepo(async (repo) => {
  commitBaseline(repo, "Waiver disabled baseline");
  await replaceOnce(repo, "src/orders.js", "0.08", "0.09");
  const initial = JSON.parse(runCli(repo, ["check", "--base", "HEAD", "--contract", ".intent/default.yaml", "--format", "json"]).stdout);
  assert.equal(initial.findings.length, 1);
  await fs.writeFile(path.join(repo, ".intent", "waivers.json"), JSON.stringify([{
    id: initial.findings[0].id,
    reason: "Should be ignored when allow_exceptions is false",
    timestamp: new Date().toISOString()
  }], null, 2));
  const blocked = runCli(repo, ["check", "--base", "HEAD", "--contract", ".intent/default.yaml", "--format", "json"]);
  assert.equal(blocked.status, 1, "Waivers must not suppress findings when allow_exceptions is false.");
  assert.equal(JSON.parse(blocked.stdout).findings.length, 1);
  console.log("PASS waiver ignored when allow_exceptions is false");
});

await withDisposableRepo(async (repo) => {
  await replaceOnce(repo, ".intent/default.yaml", "allow_exceptions: false", "allow_exceptions: true");
  commitBaseline(repo, "Waiver enabled baseline");
  await replaceOnce(repo, "src/orders.js", "0.08", "0.09");
  const initial = JSON.parse(runCli(repo, ["check", "--base", "HEAD", "--contract", ".intent/default.yaml", "--format", "json"]).stdout);
  assert.equal(initial.findings.length, 1);

  await fs.writeFile(path.join(repo, ".intent", "waivers.json"), JSON.stringify([{
    id: initial.findings[0].id,
    reason: "Approved temporary tax rate test",
    timestamp: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
  }], null, 2));
  const waived = runCli(repo, ["check", "--base", "HEAD", "--contract", ".intent/default.yaml", "--format", "json"]);
  assert.equal(waived.status, 0, `Active waiver should allow check to pass: ${waived.stderr || waived.stdout}`);
  assert.equal(JSON.parse(waived.stdout).findings.length, 0);
  console.log("PASS active waiver suppresses finding when allow_exceptions is true");

  await fs.writeFile(path.join(repo, ".intent", "waivers.json"), JSON.stringify([{
    id: initial.findings[0].id,
    reason: "Expired waiver",
    timestamp: new Date(Date.now() - 7200 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 3600 * 1000).toISOString()
  }], null, 2));
  const expired = runCli(repo, ["check", "--base", "HEAD", "--contract", ".intent/default.yaml", "--format", "json"]);
  assert.equal(expired.status, 1, "Expired waiver must not suppress findings.");
  assert.equal(JSON.parse(expired.stdout).findings.length, 1);
  console.log("PASS expired waiver does not suppress finding");
});

// Full CLI session lifecycle: start, check (text/github/--index/--revision), revert, report, hook install, stop
await withDisposableRepo(async (repo) => {
  commitBaseline(repo, "CLI lifecycle baseline");

  const started = runCli(repo, ["start", "default"]);
  assert.equal(started.status, 0, started.stderr || started.stdout);
  await fs.access(path.join(repo, ".intent", ".state.json"));

  await fs.writeFile(path.join(repo, "notes.md"), "Out-of-scope note.\n");
  await replaceOnce(repo, "src/orders.js", "0.08", "0.09");

  const activeCheck = runCli(repo, ["check"]);
  assert.equal(activeCheck.status, 1, "Active session check should fail on symbol_scope error.");
  assert.match(activeCheck.stdout, /symbol_not_allowed|calculateTax/);
  const violationsMd = await fs.readFile(path.join(repo, ".intent", ".violations.md"), "utf8");
  assert.match(violationsMd, /notes\.md/);
  assert.match(violationsMd, /orders\.js/);

  const ghCheck = runCli(repo, ["check", "--format", "github"]);
  assert.equal(ghCheck.status, 1);
  assert.match(ghCheck.stdout, /::error file=src\/orders\.js/);
  assert.match(ghCheck.stdout, /::warning file=notes\.md/);

  // --index should only inspect staged changes, ignoring unstaged working-tree edits
  const cleanIndex = runCli(repo, ["check", "--index"]);
  assert.equal(cleanIndex.status, 0, "Unstaged edits must not fail --index check.");
  git(repo, ["add", "src/orders.js"]);
  const dirtyIndex = runCli(repo, ["check", "--index"]);
  assert.equal(dirtyIndex.status, 1, "Staged symbol violation must fail --index check.");

  // hook install + real pre-commit hook blocking
  const hookInstall = runCli(repo, ["hook", "install"]);
  assert.equal(hookInstall.status, 0, hookInstall.stderr || hookInstall.stdout);
  await fs.access(path.join(repo, ".git", "hooks", "pre-commit"));
  await fs.access(path.join(repo, ".git", "hooks", "pre-push"));
  const blockedCommit = spawnSync("git", ["-C", repo, "commit", "-m", "Should be blocked by pre-commit hook"], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.notEqual(blockedCommit.status, 0, "Installed pre-commit hook must block violating commits.");
  assert.match(`${blockedCommit.stdout}\n${blockedCommit.stderr}`, /Commit BLOCKED/i);

  // Unstage and verify revert restores working tree
  git(repo, ["reset", "-q", "HEAD", "--", "src/orders.js"]);
  assert.equal(runCli(repo, ["revert", "src/orders.js"]).status, 0);
  assert.equal(runCli(repo, ["revert", "notes.md"]).status, 0);
  const cleanAfterRevert = JSON.parse(runCli(repo, ["check", "--format", "json"]).stdout);
  assert.equal(cleanAfterRevert.findings.length, 0);

  // Verify --revision checks a committed tree against the active policy baseline
  await replaceOnce(repo, "src/orders.js", "0.08", "0.09");
  git(repo, ["add", "src/orders.js"]);
  git(repo, ["commit", "--no-verify", "-m", "Commit violating change for --revision check"]);
  const revCheck = runCli(repo, ["check", "--revision", "HEAD"]);
  assert.equal(revCheck.status, 1, "--revision HEAD should detect the committed violation against baseline.");
  await replaceOnce(repo, "src/orders.js", "0.09", "0.08");
  git(repo, ["add", "src/orders.js"]);
  git(repo, ["commit", "--no-verify", "-m", "Restore clean tree"]);

  // Verify compliance report, badge, and PR comment generation
  const reportOut = path.join(repo, "custom-report.md");
  const badgeOut = path.join(repo, "custom-badge.svg");
  const prOut = path.join(repo, "custom-pr.md");
  const reportRes = runCli(repo, ["report", "--output", reportOut, "--badge", badgeOut, "--pr-comment", prOut]);
  assert.equal(reportRes.status, 0, reportRes.stderr || reportRes.stdout);
  assert.match(await fs.readFile(reportOut, "utf8"), /intent-contract-extension-testbed/);
  assert.match(await fs.readFile(badgeOut, "utf8"), /<svg[^>]*Intent Contract: passing/);
  assert.match(await fs.readFile(prOut, "utf8"), /Intent Contract CI Report: .*PASSED/);

  // Stop cleans up session state and violations summary
  assert.equal(runCli(repo, ["stop"]).status, 0);
  await assert.rejects(fs.access(path.join(repo, ".intent", ".state.json")));
  await assert.rejects(fs.access(path.join(repo, ".intent", ".violations.md")));
  console.log("PASS CLI lifecycle, github format, --index, --revision, revert, report, pre-commit hook, and stop");
});

async function withDisposableRepo(fn) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-contract-policy-"));
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
    await fn(repo);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function commitBaseline(repo, message) {
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Intent Contract Scenario"]);
  git(repo, ["config", "user.email", "intent-contract-scenario@example.invalid"]);
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "-m", message]);
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

async function replaceOnce(root, relativePath, before, after) {
  const file = path.join(root, ...relativePath.split("/"));
  const raw = await fs.readFile(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const source = raw.replace(/\r\n/g, "\n");
  const occurrences = source.split(before).length - 1;
  assert.equal(occurrences, 1, `Expected exactly one mutation target in ${relativePath}, found ${occurrences}.`);
  const updated = source.replace(before, after);
  await fs.writeFile(file, eol === "\r\n" ? updated.replace(/\n/g, "\r\n") : updated);
}
