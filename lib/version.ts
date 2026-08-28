export const SYSTEM_VERSION = "1.0.0";

const SYSTEM_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSystemVersion(version: string): [number, number, number] | null {
  const match = SYSTEM_VERSION_PATTERN.exec(version.trim().replace(/^v/, ""));
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSystemVersions(left: string, right: string): number {
  const leftParts = parseSystemVersion(left);
  const rightParts = parseSystemVersion(right);
  if (!leftParts || !rightParts) return 0;

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }

  return 0;
}

export function getDeploymentVersion(): string {
  return process.env.APP_DEPLOYMENT_VERSION?.trim() || "dev";
}
