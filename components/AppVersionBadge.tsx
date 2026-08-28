import { getDeploymentVersion, SYSTEM_VERSION } from "@/lib/version";

export default function AppVersionBadge() {
  return (
    <div className="app-version-badge" aria-label={`系统版本 ${SYSTEM_VERSION}，部署版本 ${getDeploymentVersion()}`}>
      <span>系统 v{SYSTEM_VERSION}</span>
      <span>部署 {getDeploymentVersion()}</span>
    </div>
  );
}
