package app

import (
	"meilin/backend/internal/model"
	"testing"
	"time"
)

func TestMeilinCompanionOwnershipRevisionAndContext(t *testing.T) {
	s, db, _, _ := cloudAgentProfileFixtureDB(t)
	for _, owner := range []string{"user", "other"} {
		if err := db.Create(&model.Resource{ID: "avatar-" + owner, UserID: owner, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 100, Provider: "local", ObjectKey: "avatar-" + owner + ".png", CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	first, err := s.MeilinCompanion("user")
	if err != nil || first.Name != "美林" || first.Revision != 0 {
		t.Fatalf("defaults: %#v %v", first, err)
	}
	first.ResourceID = "avatar-other"
	if _, err := s.UpdateMeilinCompanion("user", first); err == nil {
		t.Fatal("accepted another user's resource")
	}
	first.ResourceID = "avatar-user"
	first.Name = "小猫"
	if _, err := s.UpdateMeilinCompanion("other", first); err == nil {
		t.Fatal("accepted a write after switching accounts")
	}
	saved, err := s.UpdateMeilinCompanion("user", first)
	if err != nil || saved.Revision != 1 {
		t.Fatalf("save: %#v %v", saved, err)
	}
	if _, err := s.UpdateMeilinCompanion("user", first); err == nil {
		t.Fatal("accepted stale revision")
	}
	read, err := s.MeilinCompanion("user")
	if err != nil || read != saved {
		t.Fatalf("readback: %#v %v", read, err)
	}
	other, err := s.MeilinCompanion("other")
	if err != nil || other.ResourceID != "" || other.Name != "美林" {
		t.Fatal("appearance leaked across accounts")
	}
	profile, err := s.CloudAgentProfile("user", "")
	if err != nil || len(profile.Layers) != 0 {
		t.Fatalf("appearance injected into prompts: %#v %v", profile, err)
	}
	refs, err := s.repo.ResourceReferenceSnapshot("user", "", []string{"avatar-user"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, ref := range refs.Direct {
		if ref.Kind == "助手形象" && ref.ResourceID == "avatar-user" {
			found = true
		}
	}
	if !found {
		t.Fatal("active avatar was not protected from cleanup")
	}
	saved.ResourceID = ""
	if _, err := s.UpdateMeilinCompanion("user", saved); err != nil {
		t.Fatal(err)
	}
}

func TestMeilinWorkspaceOverviewOnlyOwnBoundedSummaries(t *testing.T) {
	s, _, _, _ := cloudAgentProfileFixtureDB(t)
	view, err := s.repo.MeilinWorkspaceOverview("user")
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Projects) != 1 || view.Projects[0].ID != "project-1" || len(view.Canvases) != 1 || view.Canvases[0].ID != "agent-canvas" {
		t.Fatalf("incorrect account boundary: %#v", view)
	}
}
