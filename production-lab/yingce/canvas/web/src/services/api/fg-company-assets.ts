import { http, compactApiParams } from "./request";
import type { Asset } from "@/stores/use-asset-store";

export type CompanyAsset = { id:string; resourceId:string; title:string; kind:"image"|"video"|"audio"; category:string; brand:string; character:string; style:string; view:string; note:string; status:"active"|"archived"; revision:number; createdAt:string; updatedAt:string };
export type CompanyAssetInput = Pick<CompanyAsset,"title"|"category"|"brand"|"character"|"style"|"view"|"note"> & { resourceId?:string; status?:CompanyAsset["status"]; expectedRevision?:number };
export type CompanyAssetPage = { assets:CompanyAsset[]; total:number; page:number; pageSize:number; facets:Record<string,Record<string,number>> };
export function listCompanyAssets(input: { page?:number; pageSize?:number; query?:string; kind?:string; category?:string; brand?:string; style?:string; status?:string }, signal?:AbortSignal) {
 return http.get<CompanyAssetPage>("/fg-company-assets",{params:compactApiParams(input),signal});
}
export function publishCompanyAsset(input:CompanyAssetInput) {return http.post<{asset:CompanyAsset}>("/fg-company-assets",input)}
export function updateCompanyAsset(item:CompanyAsset,input:CompanyAssetInput) {return http.patch<{asset:CompanyAsset}>(`/fg-company-assets/${encodeURIComponent(item.id)}`,{...input,expectedRevision:item.revision})}
export function useCompanyAsset(id:string) {return http.post<{asset:Asset}>(`/fg-company-assets/${encodeURIComponent(id)}/use`)}
