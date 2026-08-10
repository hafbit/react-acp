import { format, resolveConfig } from "prettier";

export async function formatReleaseSource(path, source) {
  const config = await resolveConfig(path);
  if (!config) {
    throw new Error(`Unable to resolve the Prettier configuration for ${path}.`);
  }
  return format(source, { ...config, filepath: path });
}
