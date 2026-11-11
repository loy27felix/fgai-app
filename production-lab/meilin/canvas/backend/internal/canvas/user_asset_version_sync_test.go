package canvas

import (
	"encoding/json"
	"testing"
	"time"

	"meilin/backend/internal/model"
)

func TestBrowserAssetSyncDoesNotRevertCharacterVersion(t *testing.T) {
	for _, bulk := range []bool{false, true} {
		t.Run(map[bool]string{false: "single", true: "replacement"}[bulk], func(t *testing.T) {
			svc := newCanvasHistoryTestService(t)
			now := time.Now().UTC()
			current := model.Asset{ID: "character", UserID: "owner", Kind: "entity", Category: model.AssetCategoryCharacter, PrimaryVersionID: "v3", Status: model.AssetVersionStatusConfirmed, Title: "角色", CreatedAt: now.Add(-time.Hour), UpdatedAt: now,
				PayloadJSON: `{"id":"character","kind":"entity","category":"character","title":"角色","primaryVersionId":"v3","tags":[],"data":{"definition":{"costumes":["coat"],"voice":"male"}},"coverUrl":"/api/resources/new-image/file"}`}
			if err := svc.repo.UpsertAsset(&current); err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(testUserAssetPayload("entity", map[string]any{"id": "character", "title": "已改名", "primaryVersionId": "v1", "tags": []string{"测试"}, "updatedAt": current.CreatedAt.Format(time.RFC3339Nano)}))
			if bulk {
				_, err := svc.ReplaceUserAssets("owner", AssetsSyncRequest{Assets: []json.RawMessage{raw}})
				if err != nil {
					t.Fatal(err)
				}
			} else if _, err := svc.UpsertUserAsset("owner", raw); err != nil {
				t.Fatal(err)
			}
			saved, err := svc.repo.AssetForUser("owner", "character")
			if err != nil {
				t.Fatal(err)
			}
			if saved.PrimaryVersionID != "v3" || saved.UpdatedAt.Before(current.UpdatedAt) || saved.Title != "已改名" {
				t.Fatalf("stale browser replaced current version: %#v", saved)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(saved.PayloadJSON), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["primaryVersionId"] != "v3" || payload["coverUrl"] != "/api/resources/new-image/file" {
				t.Fatalf("stale browser replaced current media: %s", saved.PayloadJSON)
			}
			definition := payload["data"].(map[string]any)["definition"].(map[string]any)
			if definition["voice"] != "male" || len(definition["costumes"].([]any)) != 1 {
				t.Fatal("costume or voice lost")
			}
		})
	}
}
