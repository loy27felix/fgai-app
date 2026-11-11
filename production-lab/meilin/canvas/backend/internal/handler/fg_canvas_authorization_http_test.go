package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"meilin/backend/internal/auth"
	"meilin/backend/internal/model"
	"meilin/backend/internal/repository"
	"meilin/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFGCanvasAuthorizationHTTPDoesNotReturnInternalErrors(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE fg_accounts(user_id TEXT PRIMARY KEY, platform_role TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"member", "admin"} {
		if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
		role := "user"
		if id == "admin" {
			role = "superadmin"
		}
		if err := db.Exec("INSERT INTO fg_accounts VALUES(?,?)", id, role).Error; err != nil {
			t.Fatal(err)
		}
	}
	deleted := time.Now()
	if err := db.Create(&model.CanvasProject{ID: "admin-deleted", UserID: "admin", Title: "private", DeletedAt: &deleted}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterUserDataRoutes(router.Group("/api"), svc)
	for _, test := range []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, "/api/canvas-projects?page=1&projectId=owner:admin", http.StatusForbidden},
		{http.MethodPost, "/api/canvas-projects/admin-deleted/restore", http.StatusNotFound},
		{http.MethodPost, "/api/canvas-projects/missing/restore", http.StatusNotFound},
	} {
		r := httptest.NewRequest(test.method, test.path, nil)
		r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "member.test-token"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != test.want {
			t.Fatalf("%s: %d %s", test.path, w.Code, w.Body.String())
		}
	}
}
