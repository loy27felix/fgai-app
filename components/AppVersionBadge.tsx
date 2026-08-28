import { getDeploymentVersion, SYSTEM_VERSION } from "@/lib/version";

export default function AppVersionBadge() {
  const deploymentVersion = getDeploymentVersion();
  const deploymentLabel = deploymentVersion === "dev" ? deploymentVersion : deploymentVersion.split("-").pop() || deploymentVersion;

  return (
    <div
      className="app-version-badge"
      aria-label={`系统版本 ${SYSTEM_VERSION}，部署版本 ${deploymentVersion}`}
      title={`系统 v${SYSTEM_VERSION} · 部署 ${deploymentVersion}`}
    >
      <span translate="no">系统 v{SYSTEM_VERSION}</span>
      <span translate="no">部署 {deploymentLabel}</span>
    </div>
  );
}
