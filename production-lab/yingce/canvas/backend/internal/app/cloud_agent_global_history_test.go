package app

import (
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestCloudAgentGlobalHistoryKeepsAccountBoundary(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	foreign := model.CloudAgentExecution{ID: "foreign-history", UserID: "someone-else", ConversationID: "foreign-history", CanvasID: "agent-canvas", Status: "completed", CreatedAt: time.Now()}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	page, err := s.CloudAgentConversations("user", "", "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != root.ID {
		t.Fatalf("global history crossed ownership: %+v", page.Items)
	}
	if _, err := s.CloudAgentConversationRuns("user", foreign.ID, "", 100); err == nil {
		t.Fatal("foreign transcript readable")
	}
	if _, err := s.CloudAgentConversations("user", "missing-canvas", "", 100); err == nil {
		t.Fatal("canvas-filtered history skipped access validation")
	}
}
