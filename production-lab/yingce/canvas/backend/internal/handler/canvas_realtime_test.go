package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestCanvasRealtimeHTTPAuthorizationBroadcastAndInvalidation(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"CREATE TABLE fg_accounts(user_id TEXT PRIMARY KEY,platform_role TEXT,email TEXT)",
		"INSERT INTO fg_accounts VALUES('user','member','alice@company.test'),('collaborator','member','bob@company.test'),('demo','user','test@beva.com')",
		"CREATE TABLE fg_story_projects(native_project_id TEXT PRIMARY KEY)",
		"INSERT INTO fg_story_projects VALUES('shared-story')",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []any{
		&model.User{ID: "user", Username: "realtime", DisplayName: "乐美林", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "collaborator", Username: "collaborator", DisplayName: "邓念", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "demo", Username: "demo", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "session", UserID: "user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AuthSession{ID: "collaborator-session", UserID: "collaborator", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AuthSession{ID: "demo-session", UserID: "demo", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.CanvasProject{ID: "canvas", UserID: "user", ProjectID: "shared-story", Revision: 1, Title: "Canvas", PayloadJSON: `{"id":"canvas","title":"Canvas","nodes":[],"connections":[]}`},
		&model.CanvasProject{ID: "foreign", UserID: "other", Revision: 1, PayloadJSON: `{}`},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterCanvasRealtimeRoutes(router.Group("/api"), svc)
	server := httptest.NewServer(router)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/canvas-projects/"
	options := &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {service.SessionCookieName + "=session.test-token"}}}
	collaborator := &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {service.SessionCookieName + "=collaborator-session.test-token"}}}
	demo := &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {service.SessionCookieName + "=demo-session.test-token"}}}
	for _, item := range []struct {
		id      string
		options *websocket.DialOptions
		status  int
	}{{"canvas", nil, 401}, {"foreign", options, 404}, {"canvas", demo, 404}} {
		conn, response, err := websocket.Dial(ctx, endpoint+item.id+"/realtime", item.options)
		if conn != nil {
			conn.CloseNow()
		}
		if err == nil || response == nil || response.StatusCode != item.status {
			t.Fatalf("authorization: status=%v err=%v", response, err)
		}
	}
	read := func(conn *websocket.Conn, match func(map[string]any) bool) map[string]any {
		t.Helper()
		for {
			var event map[string]any
			if err := wsjson.Read(ctx, conn, &event); err != nil {
				t.Fatal(err)
			}
			if match(event) {
				return event
			}
		}
	}
	a, _, err := websocket.Dial(ctx, endpoint+"canvas/realtime", options)
	if err != nil {
		t.Fatal(err)
	}
	defer a.CloseNow()
	welcomeA := read(a, func(e map[string]any) bool { return e["type"] == "welcome" })
	b, _, err := websocket.Dial(ctx, endpoint+"canvas/realtime", collaborator)
	if err != nil {
		t.Fatal(err)
	}
	defer b.CloseNow()
	welcomeB := read(b, func(e map[string]any) bool { return e["type"] == "welcome" })
	if welcomeA["selfId"] == welcomeB["selfId"] || len(welcomeB["peers"].([]any)) != 2 {
		t.Fatal("windows share an identity")
	}
	names := map[any]bool{}
	for _, peer := range welcomeB["peers"].([]any) {
		names[peer.(map[string]any)["name"]] = true
	}
	if !names["乐美林"] || !names["邓念"] {
		t.Fatalf("actor names absent: %v", names)
	}
	if err := wsjson.Write(ctx, a, map[string]any{"type": "presence", "cursor": map[string]any{"x": 25, "y": 45}, "drag": nil}); err != nil {
		t.Fatal(err)
	}
	read(b, func(e map[string]any) bool {
		peer, _ := e["peer"].(map[string]any)
		return peer != nil && peer["id"] == welcomeA["selfId"] && peer["cursor"] != nil
	})
	var project model.CanvasProject
	if err := db.First(&project, "id = ?", "canvas").Error; err != nil || project.Revision != 1 {
		t.Fatalf("presence persisted: %+v err=%v", project, err)
	}
	_, err = svc.UpsertUserCanvasProject("user", []byte(`{"id":"canvas","title":"Changed","revision":1,"nodes":[],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	read(b, func(e map[string]any) bool { return e["type"] == "invalidate" })
	_ = a.CloseNow()
	read(b, func(e map[string]any) bool { return e["type"] == "leave" && e["peerId"] == welcomeA["selfId"] })
}
