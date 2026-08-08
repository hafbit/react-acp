import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const manifestPath = resolve(repoRoot, "package.json");
export const packageName = "@hafbit/react-acp";
export const repositoryUrl = "git+https://github.com/hafbit/react-acp.git";

const releasePattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;

export function parseReleaseVersion(input) {
  const version = input?.startsWith("v") ? input.slice(1) : input;
  const match = releasePattern.exec(version ?? "");
  if (!match) {
    throw new Error(
      `Invalid release version "${input ?? ""}". Expected X.Y.Z, X.Y.Z-alpha.N, X.Y.Z-beta.N, or X.Y.Z-rc.N.`,
    );
  }
  return {
    version,
    distTag: match[4] ?? "latest",
    prerelease: Boolean(match[4]),
  };
}

export function parseReleaseTag(tag) {
  if (!tag?.startsWith("v")) {
    throw new Error("A release tag beginning with v is required.");
  }
  return parseReleaseVersion(tag);
}

export function readManifest(path = manifestPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function assertReleaseManifest(expectedVersion, manifest = readManifest()) {
  if (manifest.name !== packageName) {
    throw new Error(`Expected package name ${packageName}, found ${manifest.name}.`);
  }
  parseReleaseVersion(manifest.version);
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `Manifest version ${manifest.version} does not match release version ${expectedVersion}.`,
    );
  }
  if (
    manifest.publishConfig?.access !== "public" ||
    manifest.publishConfig?.registry !== "https://registry.npmjs.org/"
  ) {
    throw new Error(
      "@hafbit/react-acp must publish publicly to https://registry.npmjs.org/.",
    );
  }
  if (manifest.repository?.url !== repositoryUrl) {
    throw new Error(`package.json repository.url must be ${repositoryUrl}.`);
  }
  for (const path of ["dist", "README.md", "LICENSE"]) {
    if (!manifest.files?.includes(path)) {
      throw new Error(`package.json files must include ${path}.`);
    }
  }
  for (const path of [".", "./core", "./primitives"]) {
    if (!manifest.exports?.[path]?.types || !manifest.exports?.[path]?.import) {
      throw new Error(`package.json exports must include typed ESM entry ${path}.`);
    }
  }
  return manifest;
}

const defaultGit = (args, options = {}) =>
  execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();

export function assertCleanWorkingTree(runGit = defaultGit) {
  if (runGit(["status", "--porcelain"])) {
    throw new Error("The working tree must be clean before changing release versions.");
  }
}

export function assertReleaseTagGit(tag, runGit = defaultGit) {
  const ref = `refs/tags/${tag}`;
  if (runGit(["cat-file", "-t", ref]) !== "tag") {
    throw new Error(`${tag} must be an annotated tag.`);
  }
  const tagCommit = runGit(["rev-list", "-n", "1", ref]);
  try {
    runGit([
      "merge-base",
      "--is-ancestor",
      tagCommit,
      "refs/remotes/origin/latest",
    ]);
  } catch {
    throw new Error(`${tag} must point to an ancestor of origin/latest.`);
  }
  return tagCommit;
}

export const requiredPackedFiles = [
  "package/LICENSE",
  "package/README.md",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/core/index.js",
  "package/dist/core/index.d.ts",
  "package/dist/primitives/index.js",
  "package/dist/primitives/index.d.ts",
];

export function assertPackedManifest(packedManifest, sourceManifest) {
  if (
    packedManifest.name !== packageName ||
    packedManifest.version !== sourceManifest.version
  ) {
    throw new Error("Packed package name or version does not match package.json.");
  }
  assertReleaseManifest(sourceManifest.version, packedManifest);
}

export function assertPackedFiles(files, required = requiredPackedFiles) {
  const available = new Set(files);
  for (const path of required) {
    if (!available.has(path)) {
      throw new Error(`Packed tarball is missing ${path}.`);
    }
  }
}
