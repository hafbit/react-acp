import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCleanWorkingTree,
  assertPackedFiles,
  assertPackedManifest,
  assertReleaseManifest,
  assertReleaseTagGit,
  parseReleaseTag,
  parseReleaseVersion,
  requiredPackedFiles,
  repositoryUrl,
} from "./release-lib.mjs";

const manifest = (version = "1.2.3") => ({
  name: "@hafbit/react-acp",
  version,
  repository: { type: "git", url: repositoryUrl },
  files: ["dist", "README.md", "LICENSE"],
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./core": {
      types: "./dist/core/index.d.ts",
      import: "./dist/core/index.js",
    },
    "./primitives": {
      types: "./dist/primitives/index.d.ts",
      import: "./dist/primitives/index.js",
    },
  },
  publishConfig: {
    access: "public",
    registry: "https://registry.npmjs.org/",
  },
});

test("parses stable, alpha, beta, and rc releases", () => {
  assert.deepEqual(parseReleaseVersion("1.2.3"), {
    version: "1.2.3",
    distTag: "latest",
    prerelease: false,
  });
  for (const distTag of ["alpha", "beta", "rc"]) {
    assert.deepEqual(parseReleaseTag(`v1.2.3-${distTag}.4`), {
      version: `1.2.3-${distTag}.4`,
      distTag,
      prerelease: true,
    });
  }
});

test("rejects missing v prefix and unsupported prereleases", () => {
  assert.throws(() => parseReleaseTag("1.2.3"), /beginning with v/);
  for (const value of ["v1.2", "v01.2.3", "v1.2.3-next.1", "v1.2.3-alpha"])
    assert.throws(() => parseReleaseTag(value), /Invalid release version/);
});

test("validates manifest version, repository, exports, and publish target", () => {
  assert.equal(assertReleaseManifest("1.2.3", manifest()).version, "1.2.3");
  assert.throws(
    () => assertReleaseManifest("1.2.4", manifest()),
    /does not match/,
  );
  assert.throws(
    () => assertReleaseManifest(undefined, { ...manifest(), repository: {} }),
    /repository.url/,
  );
});

test("rejects dirty worktrees", () => {
  assert.doesNotThrow(() => assertCleanWorkingTree(() => ""));
  assert.throws(() => assertCleanWorkingTree(() => " M package.json"), /clean/);
});

test("requires an annotated tag on origin/latest", () => {
  const run = (args) => {
    if (args[0] === "cat-file") return "tag";
    if (args[0] === "rev-list") return "abc123";
    if (args[0] === "merge-base") return "";
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };
  assert.equal(assertReleaseTagGit("v1.2.3", run), "abc123");
  assert.throws(
    () => assertReleaseTagGit("v1.2.3", (args) => (args[0] === "cat-file" ? "commit" : "")),
    /annotated/,
  );
  assert.throws(
    () =>
      assertReleaseTagGit("v1.2.3", (args) => {
        if (args[0] === "cat-file") return "tag";
        if (args[0] === "rev-list") return "abc123";
        throw new Error("not ancestor");
      }),
    /origin\/latest/,
  );
});

test("validates packed metadata and required files", () => {
  const source = manifest();
  assert.doesNotThrow(() => assertPackedManifest(manifest(), source));
  assert.throws(() => assertPackedManifest(manifest("1.2.4"), source), /name or version/);
  assert.doesNotThrow(() => assertPackedFiles(requiredPackedFiles));
  assert.throws(
    () => assertPackedFiles(requiredPackedFiles.filter((path) => path !== "package/LICENSE")),
    /package\/LICENSE/,
  );
});
