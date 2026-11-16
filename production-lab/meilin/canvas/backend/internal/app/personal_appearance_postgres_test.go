package app

import (
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"meilin/backend/internal/database"
	"meilin/backend/internal/model"
	"meilin/backend/internal/repository"
)

func TestPersonalAppearancePostgresRoundTrip(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL not configured")
	}
	base, err := database.Open(database.Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, _ := base.DB()
	defer baseSQL.Close()
	schema := fmt.Sprintf("appearance_%d", time.Now().UnixNano())
	if err := base.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	defer base.Exec("DROP SCHEMA " + schema + " CASCADE")
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := database.Open(database.Config{Driver: "postgres", DSN: parsed.String()})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.AgentProfile{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	pref, err := svc.PersonalAppearance("appearance-owner")
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"dark", "light", "system"} {
		pref.Mode, pref.Font, pref.SkinID = mode, "serif", "longying-ink"
		pref, err = svc.UpdatePersonalAppearance("appearance-owner", pref)
		if err != nil {
			t.Fatalf("save %s: %v", mode, err)
		}
		read, err := svc.PersonalAppearance("appearance-owner")
		if err != nil || read != pref {
			t.Fatalf("read %s: %+v %v", mode, read, err)
		}
	}
	other, err := svc.PersonalAppearance("appearance-other")
	if err != nil || other.Revision != 0 || other.SkinID != "site" {
		t.Fatalf("account isolation: %+v %v", other, err)
	}
}
