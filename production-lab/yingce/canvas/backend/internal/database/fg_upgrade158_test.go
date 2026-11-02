package database

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestFG158MigrationFrom78PreservesExistingWork(t *testing.T) {
	config := Config{Driver: "sqlite", DSN: "file:fg158-upgrade?mode=memory&cache=shared"}
	if dsn := os.Getenv("FG158_TEST_POSTGRES_DSN"); dsn != "" {
		config = Config{Driver: "postgres", DSN: dsn}
	}
	db, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	defer connection.Close()
	if err = db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 78 {
			break
		}
		if err = item.apply(db); err != nil {
			t.Fatal(err)
		}
		if err = db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Build a schema78 shape: baseline structs already include the new fields.
	for _, column := range []struct {
		entity any
		field  string
	}{
		{&model.User{}, "UserGroup"}, {&model.ChannelModel{}, "PriceCurrency"},
		{&model.TopupProduct{}, "Currency"}, {&model.BillingOrder{}, "UserGroup"},
		{&model.BillingOrder{}, "PriceCurrency"}, {&model.BillingOrder{}, "CurrencyRateMicrocredits"},
	} {
		if db.Migrator().HasColumn(column.entity, column.field) {
			if db.Dialector.Name() == "sqlite" && db.Migrator().HasIndex(column.entity, column.field) {
				if err = db.Migrator().DropIndex(column.entity, column.field); err != nil {
					t.Fatal(err)
				}
			}
			if err = db.Migrator().DropColumn(column.entity, column.field); err != nil {
				t.Fatal(err)
			}
		}
	}
	chapter := model.ProjectUnit{ID: "fg158-chapter", ProjectID: "fg158-project", SourceText: "Original English dialogue", Title: "Keep chapter"}
	revision := model.ShotRevision{ID: "fg158-revision", ShotID: "fg158-shot", VideoPrompt: "Keep prompt", Dialogue: "Ella: Original words.", ActionBeatsJSON: `[{"kind":"character_costume_timeline","assetId":"actor","segments":[]}]`}
	for _, item := range []any{&chapter, &revision} {
		if err = db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Table("users").Create(map[string]any{"id": "fg158-user", "username": "fg158-user", "status": "active", "role": "user"}).Error; err != nil {
		t.Fatal(err)
	}
	var beforeRows []schemaMigration
	db.Where("version <= 78").Order("version").Find(&beforeRows)
	before, _ := json.Marshal(beforeRows)
	for i := 0; i < 2; i++ {
		if err = MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var afterRows []schemaMigration
	db.Where("version <= 78").Order("version").Find(&afterRows)
	after, _ := json.Marshal(afterRows)
	if string(before) != string(after) {
		t.Fatal("existing migration ledger changed")
	}
	var got model.ShotRevision
	if err = db.First(&got, "id = ?", revision.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.VideoPrompt != revision.VideoPrompt || got.Dialogue != revision.Dialogue || got.ActionBeatsJSON != revision.ActionBeatsJSON {
		t.Fatal("existing creative work changed")
	}
	var user model.User
	if err = db.First(&user, "id = ?", "fg158-user").Error; err != nil || user.UserGroup != "" {
		t.Fatalf("existing user reassigned: %v", err)
	}
	for _, entity := range []any{&model.UserGroup{}, &model.UserGroupChannel{}, &model.AgentMemoryDocument{}, &model.AgentMemoryDocumentRevision{}} {
		if !db.Migrator().HasTable(entity) {
			t.Fatal("new table missing")
		}
	}
	if err = RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}
