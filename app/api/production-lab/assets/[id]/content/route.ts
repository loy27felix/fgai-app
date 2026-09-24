import { NextResponse } from "next/server";
import { labActor } from "@/lib/production-lab/access";
import { findLabAsset, PRODUCTION_LAB_ASSET_BUCKET } from "@/lib/production-lab/media-store";
import { localStorage } from "@/lib/local/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!await labActor()) return new NextResponse("无试用权限", { status: 403 });
  try {
    const asset = await findLabAsset(params.id);
    if (!asset) return new NextResponse("素材不存在", { status: 404 });
    const signed = await localStorage(PRODUCTION_LAB_ASSET_BUCKET).createSignedUrl(asset.storage_path, 900);
    if (signed.error || !signed.data?.signedUrl) return new NextResponse("素材暂不可用", { status: 503 });
    return NextResponse.redirect(new URL(signed.data.signedUrl, request.url), 302);
  } catch { return new NextResponse("素材服务暂不可用", { status: 503 }); }
}
