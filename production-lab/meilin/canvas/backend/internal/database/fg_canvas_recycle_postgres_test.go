package database

import (
	"fmt"
	"meilin/backend/internal/model"
	"net/url"
	"os"
	"testing"
	"time"
)

// Opt-in integration check, confined to a disposable schema with no NAS data.
func TestFGCanvasRecyclePostgresUpgrade(t *testing.T) {
	dsn := os.Getenv("FG_QA_DATABASE_URL")
	if dsn == "" {
		t.Skip("disposable PostgreSQL integration not configured")
	}
	root, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, _ := root.DB()
	defer rootSQL.Close()
	schema := fmt.Sprintf("fg_recycle_qa_%d", time.Now().UnixNano())
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := root.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
	}()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("options", "-c search_path="+schema)
	parsed.RawQuery = query.Encode()
	db, err := Open(Config{Driver: "postgres", DSN: parsed.String()})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := db.DB()
	defer handle.Close()
	// Start with the actual pre-recycle table shape, preserving an existing row.
	if err = db.Exec("CREATE TABLE canvas_projects(id varchar(36) PRIMARY KEY,user_id varchar(36),project_id varchar(36),title text,payload_json text,revision bigint,created_at timestamptz,updated_at timestamptz)").Error; err != nil {
		t.Fatal(err)
	}
	before := model.CanvasProject{ID: "existing", UserID: "owner", Title: "真实 PostgreSQL 迁移验收", PayloadJSON: `{"nodes":[{"id":"preserved"}]}`, Revision: 11}
	if err = db.Select("ID", "UserID", "ProjectID", "Title", "PayloadJSON", "Revision", "CreatedAt", "UpdatedAt").Create(&before).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		for _, migration := range schemaMigrations {
			if migration.version < 50 {
				continue
			}
			if err = db.Transaction(migration.apply); err != nil {
				t.Fatal(err)
			}
		}
	}
	var after model.CanvasProject
	if err = db.First(&after, "id = ?", before.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Title != before.Title || after.PayloadJSON != before.PayloadJSON || after.Revision != 11 || after.DeletedAt != nil || after.DeletedBy != "" {
		t.Fatal("PostgreSQL upgrade modified existing canvas")
	}
	if err = db.Model(&model.CanvasProject{}).Where("id = ?", before.ID).Updates(map[string]any{"deleted_at": time.Now(), "deleted_by": "admin", "revision": 12}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.CanvasProject{}).Where("id = ?", before.ID).Updates(map[string]any{"deleted_at": nil, "deleted_by": "", "revision": 13}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.First(&after, "id = ?", before.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.DeletedAt != nil || after.DeletedBy != "" || after.PayloadJSON != before.PayloadJSON || after.Revision != 13 {
		t.Fatal("PostgreSQL recovery failed")
	}
}
