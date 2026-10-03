import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageHeader } from "../components/Layout.tsx";
import { AssetContactSheet } from "../features/assets/AssetContactSheet.tsx";
import { RecommendedCharacterGrid } from "../features/assets/RecommendedCharacterGrid.tsx";
import { RecommendedSceneHologram } from "../features/assets/RecommendedSceneHologram.tsx";
import { useAgentCanvasAssets } from "../features/agent-canvas/assets/useAgentCanvasAssets.ts";
import type { AgentAssetBrowserItem } from "../features/agent-canvas/assets/assetSelection.ts";
import type { V2AssetLibraryCategory } from "../types-v2.ts";
import "./assets.css";

type AssetPageScope = "my" | "recommended";

const CanonicalAssetViewer = lazy(() => import("../features/assets/CanonicalAssetViewer.tsx").then((module) => ({
  default: module.CanonicalAssetViewer,
})));

const ASSET_CATEGORIES: Array<{ id: V2AssetLibraryCategory; label: string }> = [
  { id: "characters", label: "角色" },
  { id: "scenes", label: "场景" },
  { id: "props", label: "道具" },
];

export function AssetsPage() {
  const [scope, setScope] = useState<AssetPageScope>("my");
  const [category, setCategory] = useState<V2AssetLibraryCategory>("characters");
  const [search, setSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const assetLibraryRef = useRef<HTMLElement | null>(null);
  const selectedCardRef = useRef<HTMLButtonElement | null>(null);
  const assetCardRefsRef = useRef(new Map<string, HTMLButtonElement>());
  const library = useAgentCanvasAssets({ scope, category, mediaType: "image", search });
  const displayedAssets = useMemo(
    () => library.loading ? [] : library.items,
    [library.items, library.loading],
  );
  const showRecommendedCharacterGrid = scope === "recommended" && category === "characters";
  const showRecommendedSceneHologram = scope === "recommended" && category === "scenes";
  const selectedAsset = useMemo(
    () => displayedAssets.find((asset) => asset.id === selectedAssetId) ?? null,
    [displayedAssets, selectedAssetId],
  );

  const restoreViewerFocus = useCallback(() => {
    if (selectedCardRef.current?.isConnected) {
      selectedCardRef.current.focus();
      return;
    }
    assetLibraryRef.current?.querySelector<HTMLButtonElement>('.v2-asset-library-tabs button[aria-selected="true"]')?.focus();
  }, []);

  const closePreview = useCallback(({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
    if (restoreFocus) restoreViewerFocus();
    setSelectedAssetId(null);
  }, [restoreViewerFocus]);

  const navigateSelectedAsset = useCallback((direction: -1 | 1) => {
    if (!selectedAssetId || displayedAssets.length < 2) return;
    const currentIndex = displayedAssets.findIndex((asset) => asset.id === selectedAssetId);
    if (currentIndex < 0) return;
    const nextIndex = (currentIndex + direction + displayedAssets.length) % displayedAssets.length;
    const nextAsset = displayedAssets[nextIndex];
    if (!nextAsset) return;
    selectedCardRef.current = assetCardRefsRef.current.get(nextAsset.id) ?? null;
    setSelectedAssetId(nextAsset.id);
  }, [displayedAssets, selectedAssetId]);

  useEffect(() => {
    if (library.loading || !selectedAssetId || selectedAsset) return;
    closePreview({ restoreFocus: false });
  }, [closePreview, library.loading, selectedAsset, selectedAssetId]);

  function selectAsset(asset: AgentAssetBrowserItem, trigger: HTMLButtonElement) {
    selectedCardRef.current = trigger;
    setSelectedAssetId(asset.id);
  }

  function changeScope(nextScope: AssetPageScope) {
    if (nextScope === scope) return;
    closePreview({ restoreFocus: false });
    setScope(nextScope);
  }

  function changeCategory(nextCategory: V2AssetLibraryCategory) {
    if (nextCategory === category) return;
    closePreview({ restoreFocus: false });
    setCategory(nextCategory);
  }

  return (
    <section ref={assetLibraryRef} className="v2-asset-library-page">
      <PageHeader title="广告素材" subtitle="可重复使用的角色、场景和道具。公司公共素材从上方入口引用。" />
      <div className="v2-asset-library-controls">
        <div className="v2-asset-library-tabs" role="tablist" aria-label="Asset library scope">
          <button className={scope === "my" ? "is-active" : ""} type="button" role="tab" aria-selected={scope === "my"} onClick={() => changeScope("my")}>我的素材</button>
          <button className={scope === "recommended" ? "is-active" : ""} type="button" role="tab" aria-selected={scope === "recommended"} onClick={() => changeScope("recommended")}>推荐素材</button>
        </div>
        <div className="v2-asset-library-actions">
          <input aria-label="搜索素材" value={search} placeholder="搜索素材" onChange={(event) => setSearch(event.currentTarget.value)} />
        </div>
      </div>
      <div className="v2-asset-library-categories" role="tablist" aria-label="Asset category">
        {ASSET_CATEGORIES.map((item) => (
          <button key={item.id} className={category === item.id ? "is-active" : ""} type="button" role="tab" aria-selected={category === item.id} onClick={() => changeCategory(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="v2-asset-library-layout">
        <div>
          {showRecommendedCharacterGrid ? (
            <RecommendedCharacterGrid
              assets={displayedAssets}
              selectedAssetId={selectedAssetId}
              loading={library.loading}
              error={library.error}
              buttonRef={(assetId, button) => {
                if (button) assetCardRefsRef.current.set(assetId, button);
                else assetCardRefsRef.current.delete(assetId);
              }}
              onSelect={selectAsset}
            />
          ) : (
            <>
              {library.error ? <p className="asset-library-status is-error">{library.error}</p> : null}
              {library.loading ? <p className="asset-library-status">加载素材中…</p> : null}
              {!library.loading && !library.error && !displayedAssets.length ? <p className="asset-library-empty">暂无素材</p> : null}
              {showRecommendedSceneHologram ? (
                <RecommendedSceneHologram
                  assets={displayedAssets}
                  buttonRef={(assetId, button) => {
                    if (button) assetCardRefsRef.current.set(assetId, button);
                    else assetCardRefsRef.current.delete(assetId);
                  }}
                  onOpen={selectAsset}
                  viewerOpen={Boolean(selectedAsset)}
                />
              ) : (
                <AssetContactSheet
                  assets={displayedAssets}
                  selectedAssetId={selectedAssetId}
                  buttonRef={(assetId, button) => {
                    if (button) assetCardRefsRef.current.set(assetId, button);
                    else assetCardRefsRef.current.delete(assetId);
                  }}
                  onSelect={selectAsset}
                />
              )}
            </>
          )}
        </div>
      </div>
      {selectedAsset ? (
        <Suspense fallback={null}>
          <CanonicalAssetViewer
            item={selectedAsset}
            hasAssetNavigation={displayedAssets.length > 1}
            onPreviousAsset={() => navigateSelectedAsset(-1)}
            onNextAsset={() => navigateSelectedAsset(1)}
            onClose={closePreview}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
