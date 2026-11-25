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
    change: async (root) => fs.writeFile(path.join(root, "notes.md"), "Outside the declared edit scope.\n")
  },
  {
    name: "read-only architecture policy is protected",
    expected: ["scope"],
    change: async (root) => fs.appendFile(path.join(root, "docs", "architecture.mmd"), "\n  Extension --> Tests\n")
  },
  {
    name: "contract policy tampering is reported",
    expected: ["scope"],
    change: async (root) => fs.appendFile(path.join(root, ".intent", "default.yaml"), "\n# tampering attempt\n")
  },
  {
    name: "unlisted symbol edit is reported",
    expected: ["symbol_scope"],
    change: async (root) => fs.appendFile(path.join(root, "src", "extension.js"), "\nexport function unlistedHelper() { return false; }\n")
  },
  {
    name: "new dependency is reported",
    expected: ["dependencies"],
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
    forbidden: ["high_risk_files"],
    change: async (root) => fs.appendFile(path.join(root, ".github", "workflows", "approved.yml"), "\n# explicitly excluded from high-risk findings\n")
  },
  {
    name: "default high-risk CI path is reported",
    expected: ["high_risk_files"],
    change: async (root) => fs.appendFile(path.join(root, ".github", "workflows", "ci.yml"), "\n# changed workflow\n")
  },
  {
    name: "test matcher downgrade is reported",
    expected: ["test_weakening"],
    change: async (root) => {
      await replaceOnce(root, "test/contract.test.js", ".toEqual([])", ".toBeTruthy()");
    }
  },
  {
    name: "assertion-free test is reported",
    expected: ["tautological_tests"],
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
    change: async (root) => fs.appendFile(path.join(root, "src", "contract.js"), '\nimport { runIntentChecks } from "./extension.js";\nvoid runIntentChecks;\n')
  },
  {
    name: "invalid contract is rejected",
    exitCode: 2,
    beforeCommit: async (root) => fs.writeFile(path.join(root, ".intent", "default.yaml"), "name: invalid\nintent: invalid\nunknown_key: true\n")
  }
];

for (const scenario of scenarios) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-contract-policy-"));
  const repo = path.join(tempRoot, "workspace");
  try {
    await fs.cp(fixtureRoot, repo, { recursive: true });
    if (scenario.beforeCommit) await scenario.beforeCommit(repo);
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.name", "Intent Contract Scenario"]);
    git(repo, ["config", "user.email", "intent-contract-scenario@example.invalid"]);
    git(repo, ["add", "--all"]);
    git(repo, ["commit", "-m", "Scenario policy baseline"]);

    if (scenario.change) await scenario.change(repo);
    const result = spawnSync(process.execPath, [
      cliPath,
      "check",
      "--base",
      "HEAD",
      "--contract",
      ".intent/default.yaml",
      "--format",
      "json"
    ], { cwd: repo, encoding: "utf8", windowsHide: true });

    const expectedExitCode = scenario.exitCode ?? (scenario.expected.length > 0 ? 1 : 0);
    assert.equal(result.status, expectedExitCode, `${scenario.name}: ${result.stderr || result.stdout}`);

    if (scenario.exitCode === 2) {
      assert.match(`${result.stdout}\n${result.stderr}`, /default\.yaml|contract/i, `${scenario.name}: expected a contract validation error`);
    } else {
      const report = JSON.parse(result.stdout);
      const detectors = new Set(report.findings.map((finding) => finding.detector));
      for (const detector of scenario.expected) {
        assert.ok(detectors.has(detector), `${scenario.name}: expected detector "${detector}", got ${[...detectors].join(", ") || "no findings"}`);
      }
      for (const detector of scenario.forbidden ?? []) {
        assert.ok(!detectors.has(detector), `${scenario.name}: detector "${detector}" should have been excluded`);
      }
    }

    console.log(`PASS ${scenario.name}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

async function replaceOnce(root, relativePath, before, after) {
  const file = path.join(root, ...relativePath.split("/"));
  const source = await fs.readFile(file, "utf8");
  const occurrences = source.split(before).length - 1;
  assert.equal(occurrences, 1, `Expected exactly one mutation target in ${relativePath}, found ${occurrences}.`);
  await fs.writeFile(file, source.replace(before, after));
}
