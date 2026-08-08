import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const manifestPath = resolve(repoRoot, "package.json");
export const jsrManifestPath = resolve(repoRoot, "jsr.json");
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

export function readJsrManifest(path = jsrManifestPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export const jsrExports = {
  ".": "./src/index.ts",
  "./core": "./src/core/index.ts",
  "./primitives": "./src/primitives/index.ts",
};

export const requiredJsrFiles = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "README.md",
  "LICENSE",
  "package.json",
];

export function assertJsrManifest(expectedVersion, manifest = readJsrManifest()) {
  if (manifest.name !== packageName) {
    throw new Error(`Expected JSR package name ${packageName}, found ${manifest.name}.`);
  }
  parseReleaseVersion(manifest.version);
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `JSR manifest version ${manifest.version} does not match release version ${expectedVersion}.`,
    );
  }
  for (const [path, source] of Object.entries(jsrExports)) {
    if (manifest.exports?.[path] !== source) {
      throw new Error(`jsr.json export ${path} must be ${source}.`);
    }
  }
  const included = new Set(manifest.publish?.include ?? []);
  for (const path of requiredJsrFiles) {
    if (!included.has(path)) {
      throw new Error(`jsr.json publish.include must include ${path}.`);
    }
  }
  return manifest;
}

export function assertReleaseManifests(
  expectedVersion,
  npmManifest = readManifest(),
  jsrManifest = readJsrManifest(),
) {
  const npmPackage = assertReleaseManifest(expectedVersion, npmManifest);
  const jsrPackage = assertJsrManifest(expectedVersion, jsrManifest);
  if (npmPackage.version !== jsrPackage.version) {
    throw new Error(
      `package.json version ${npmPackage.version} does not match jsr.json version ${jsrPackage.version}.`,
    );
  }
  return { npmManifest: npmPackage, jsrManifest: jsrPackage };
}

export function updateReleaseManifests(
  versionInput,
  npmManifest = readManifest(),
  jsrManifest = readJsrManifest(),
) {
  const { version } = parseReleaseVersion(versionInput);
  const current = assertReleaseManifests(undefined, npmManifest, jsrManifest);
  return {
    npmManifest: { ...current.npmManifest, version },
    jsrManifest: { ...current.jsrManifest, version },
  };
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

export function assertJsrRepairGit(version, sourceRef, runGit = defaultGit) {
  const release = parseReleaseVersion(version);
  if (sourceRef === "latest" && release.version === "0.1.0") {
    const head = runGit(["rev-parse", "HEAD"]);
    const latest = runGit(["rev-parse", "refs/remotes/origin/latest"]);
    if (head !== latest) {
      throw new Error("The 0.1.0 JSR backfill must run from the tip of origin/latest.");
    }
    return head;
  }
  const expectedTag = `v${release.version}`;
  if (sourceRef !== expectedTag) {
    throw new Error(`JSR repair source_ref must be ${expectedTag}.`);
  }
  return assertReleaseTagGit(expectedTag, runGit);
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
