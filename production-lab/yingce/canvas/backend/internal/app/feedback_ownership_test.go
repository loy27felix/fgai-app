package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestFeedbackAttachmentsRequireOwnershipAndCanonicalResource(t *testing.T) {
	s, _, user := newTestFeedbackService(t)
	for _, resource := range []model.Resource{
		{ID: "owned", UserID: user.ID, MimeType: "image/png"},
		{ID: "foreign", UserID: "someone-else", MimeType: "image/png"},
		{ID: "document", UserID: user.ID, MimeType: "text/plain"},
	} {
		if err := s.repo.CreateResource(&resource); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{`[{"id":"foreign"}]`, `[{"id":"missing"}]`, `[{"id":"document"}]`, `[{"id":"owned"},{"id":"owned"}]`, `not json`} {
		if _, err := s.feedbackAttachments(user.ID, raw); err == nil {
			t.Fatalf("accepted invalid attachments %s", raw)
		}
	}
	raw, err := s.feedbackAttachments(user.ID, `[{"id":"owned","name":"screenshot.png","type":"video","url":"https://untrusted.invalid/tracker","mimeType":"video/mp4"}]`)
	if err != nil {
		t.Fatal(err)
	}
	var items []model.FeedbackAttachment
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].URL != "/api/resources/owned/file" || items[0].Type != "image" || items[0].MimeType != "image/png" {
		t.Fatalf("untrusted metadata retained: %s", raw)
	}
	if _, err := s.AdminUpdateFeedback(user, "anything", AdminUpdateFeedbackRequest{Status: model.FeedbackStatusResolved}); err == nil {
		t.Fatal("ordinary user can reply as admin")
	}
	_, err = s.SubmitFeedback(user, SubmitFeedbackRequest{Title: strings.Repeat("图", 200), Content: "正文"})
	if err != nil {
		t.Fatalf("Chinese title counted as bytes: %v", err)
	}
}
