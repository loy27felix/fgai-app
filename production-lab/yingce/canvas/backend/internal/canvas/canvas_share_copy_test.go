package canvas

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type shareCopyTestHost struct {
	nopHost
	repo              *repository.Repository
	copies, discarded int
	failAt            int
	afterCopy         func()
	failQuota         bool
}

func (h *shareCopyTestHost) CopySharedCanvasResource(userID string, source *model.Resource) (*model.Resource, error) {
	h.copies++
	if h.failAt == h.copies {
		return nil, errors.New("copy failed")
	}
	copy := *source
	copy.ID, copy.UserID, copy.ObjectKey = kernel.NewID(), userID, "users/"+userID+"/"+kernel.NewID()
	if err := h.repo.Create(&copy); err != nil {
		return nil, err
	}
	if h.afterCopy != nil {
		h.afterCopy()
	}
	return &copy, nil
}

func (h *shareCopyTestHost) DiscardSharedCanvasResource(resource *model.Resource) error {
	h.discarded++
	return h.repo.DeleteResource(resource.UserID, resource.ID)
}

func (h *shareCopyTestHost) CanvasCopyQuota(string, []model.Asset, int64) error {
	if h.failQuota {
		return errors.New("quota exceeded")
	}
	return nil
}

func shareCopyFixture(t *testing.T) (*Service, *shareCopyTestHost, *gorm.DB, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "copy.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.CanvasShare{}, &model.Resource{}, &model.Asset{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	repo := repository.New(db)
	host := &shareCopyTestHost{repo: repo}
	svc := New(repo, host)
	token := strings.Repeat("share-token", 4)
	now := time.Now().UTC()
	for _, value := range []any{
		&model.Resource{ID: "source-image", UserID: "owner", Kind: "image", Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "users/owner/image.png", MimeType: "image/png", Size: 123, Width: 10, Height: 20},
		&model.Resource{ID: "source-video", UserID: "owner", Kind: "video", Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "users/owner/video.mp4", MimeType: "video/mp4", Size: 456, DurationMs: 2000},
		&model.CanvasProject{ID: "original", UserID: "owner", ProjectID: "shared-story", Title: "Original", Revision: 3, CreatedAt: now, UpdatedAt: now, PayloadJSON: `{"id":"original","projectId":"shared-story","nodes":[{"id":"image","type":"image","title":"Image","position":{"x":1,"y":2},"width":10,"height":20,"metadata":{"storageKey":"resource:source-image","apiKey":"secret","taskId":"old-task","status":"loading","prompt":"keep prompt"}},{"id":"image2","type":"image","metadata":{"storageKey":"resource:source-image"}},{"id":"video","type":"video","metadata":{"storageKey":"resource:source-video"}},{"id":"text","type":"text","metadata":{"content":"keep text"}}],"connections":[{"id":"edge","fromNodeId":"image","toNodeId":"video"}],"chatSessions":[{"secret":"chat"}]}`},
		&model.CanvasShare{ID: "share", UserID: "owner", ProjectID: "original", TokenHash: canvasShareTokenHash(token), Enabled: true},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	return svc, host, db, token
}

func TestSharedCanvasCopyIsPrivateAndIndependent(t *testing.T) {
	svc, host, db, token := shareCopyFixture(t)
	before, _ := svc.repo.CanvasProjectForUser("owner", "original")
	copy, err := svc.CopySharedCanvas("recipient", token)
	if err != nil {
		t.Fatal(err)
	}
	if host.copies != 2 || host.discarded != 0 {
		t.Fatalf("expected two unique media copies: %+v", host)
	}
	var document map[string]any
	if err := json.Unmarshal(copy, &document); err != nil {
		t.Fatal(err)
	}
	id := document["id"].(string)
	if id == "original" || document["projectId"] != "" || document["revision"] != float64(1) {
		t.Fatalf("bad independent canvas: %s", copy)
	}
	for _, forbidden := range []string{"source-image", "source-video", "share-token", "secret", "old-task", "shared-story", `"status":"loading"`} {
		if strings.Contains(string(copy), forbidden) {
			t.Fatalf("copy retained private or source state %q", forbidden)
		}
	}
	if !strings.Contains(string(copy), "keep prompt") || !strings.Contains(string(copy), "keep text") {
		t.Fatal("lost creative content")
	}
	if err := svc.ValidateCanvasMediaAssets("recipient", copy); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UserCanvasProject("owner", id); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("owner accessed recipient copy: %v", err)
	}
	if _, err := svc.UserCanvasProject("recipient", "original"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("token granted ordinary private access: %v", err)
	}
	if err := svc.DeleteCanvasShare("owner", "original"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CopySharedCanvas("recipient", token); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("revoked copy: %v", err)
	}
	document["title"], document["revision"] = "Edited copy", 1
	raw, _ := json.Marshal(document)
	if _, err := svc.UpsertUserCanvasProject("recipient", raw); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.repo.CanvasProjectForUser("owner", "original")
	if before.PayloadJSON != after.PayloadJSON || before.Revision != after.Revision {
		t.Fatal("copy changed original")
	}
	if err := db.Where("user_id = ?", "owner").Delete(&model.Resource{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.ValidateCanvasMediaAssets("recipient", raw); err != nil {
		t.Fatalf("original removal broke independent copy: %v", err)
	}
}

func TestSharedCanvasCopyRollsBackOnMediaFailureAndRevocation(t *testing.T) {
	for _, scenario := range []string{"media-failure", "revoked-during-copy", "expired", "foreign-resource", "anonymous", "quota"} {
		t.Run(scenario, func(t *testing.T) {
			svc, host, db, token := shareCopyFixture(t)
			user := "recipient"
			switch scenario {
			case "media-failure":
				host.failAt = 2
			case "revoked-during-copy":
				host.afterCopy = func() { _ = db.Model(&model.CanvasShare{}).Where("id = ?", "share").Update("enabled", false).Error }
			case "expired":
				_ = db.Model(&model.CanvasShare{}).Where("id = ?", "share").Update("expires_at", time.Now().Add(-time.Minute)).Error
			case "foreign-resource":
				_ = db.Model(&model.Resource{}).Where("id = ?", "source-video").Update("user_id", "outsider").Error
			case "anonymous":
				user = ""
			case "quota":
				host.failQuota = true
			}
			if _, err := svc.CopySharedCanvas(user, token); err == nil {
				t.Fatal("invalid copy succeeded")
			}
			for _, table := range []any{&model.CanvasProject{}, &model.Asset{}, &model.Resource{}} {
				var count int64
				if err := db.Model(table).Where("user_id = ?", "recipient").Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("partial copy remains: count=%d err=%v", count, err)
				}
			}
			if host.copies > 0 && host.discarded != host.copies-1 && scenario == "media-failure" {
				t.Fatal("successful partial media was not discarded")
			}
		})
	}
}
