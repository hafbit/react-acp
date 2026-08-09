import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCleanWorkingTree,
  assertJsrManifest,
  assertJsrRepairGit,
  assertPackedFiles,
  assertPackedManifest,
  assertReleaseManifest,
  assertReleaseManifests,
  assertReleaseTagGit,
  parseReleaseTag,
  parseReleaseVersion,
  requiredPackedFiles,
  repositoryUrl,
  updateReleaseManifests,
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

const jsrManifest = (version = "1.2.3") => ({
  name: "@hafbit/react-acp",
  version,
  exports: {
    ".": "./src/index.ts",
    "./core": "./src/core/index.ts",
    "./primitives": "./src/primitives/index.ts",
  },
  publish: {
    include: ["src/**/*.ts", "src/**/*.tsx", "README.md", "LICENSE", "package.json"],
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
  assert.throws(() => assertReleaseManifest("1.2.4", manifest()), /does not match/);
  assert.throws(
    () => assertReleaseManifest(undefined, { ...manifest(), repository: {} }),
    /repository.url/,
  );
});

test("validates synchronized npm and JSR manifests", () => {
  assert.equal(assertJsrManifest("1.2.3", jsrManifest()).version, "1.2.3");
  assert.doesNotThrow(() => assertReleaseManifests("1.2.3", manifest(), jsrManifest()));
  assert.throws(
    () => assertReleaseManifests(undefined, manifest(), jsrManifest("1.2.4")),
    /does not match jsr.json/,
  );
  assert.throws(
    () =>
      assertJsrManifest("1.2.3", {
        ...jsrManifest(),
        exports: { ...jsrManifest().exports, "./core": "./dist/core/index.js" },
      }),
    /export \.\/core/,
  );
  assert.throws(
    () => assertJsrManifest("1.2.3", { ...jsrManifest(), name: "@hafbit/wrong" }),
    /JSR package name/,
  );
  assert.throws(
    () =>
      assertJsrManifest("1.2.3", {
        ...jsrManifest(),
        publish: { include: ["src/**/*.ts"] },
      }),
    /publish.include/,
  );
});

test("updates npm and JSR versions together", () => {
  const updated = updateReleaseManifests("2.0.0-rc.1", manifest(), jsrManifest());
  assert.equal(updated.npmManifest.version, "2.0.0-rc.1");
  assert.equal(updated.jsrManifest.version, "2.0.0-rc.1");
  assert.equal(updated.npmManifest.name, "@hafbit/react-acp");
  assert.equal(updated.jsrManifest.exports["./core"], "./src/core/index.ts");
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

test("restricts JSR repair sources and the 0.1.0 latest backfill", () => {
  const tagged = (args) => {
    if (args[0] === "cat-file") return "tag";
    if (args[0] === "rev-list") return "abc123";
    if (args[0] === "merge-base") return "";
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };
  assert.equal(assertJsrRepairGit("1.2.3", "v1.2.3", tagged), "abc123");
  assert.throws(() => assertJsrRepairGit("1.2.3", "latest", tagged), /must be v1.2.3/);

  const latest = (args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") return "tip";
    if (args[0] === "rev-parse") return "tip";
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };
  assert.equal(assertJsrRepairGit("0.1.0", "latest", latest), "tip");
  assert.throws(
    () => assertJsrRepairGit("0.1.0", "latest", (args) => (args[1] === "HEAD" ? "old" : "tip")),
    /tip of origin\/latest/,
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
