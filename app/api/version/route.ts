import { NextResponse } from "next/server";
import { getDeploymentVersion, SYSTEM_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      systemVersion: SYSTEM_VERSION,
      requiredSystemVersion: SYSTEM_VERSION,
      deploymentVersion: getDeploymentVersion(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
