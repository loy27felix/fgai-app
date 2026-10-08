package auth

import (
	"errors"
	"infinite-canvas/backend/internal/kernel"
	"net/http"
	"strings"
	"testing"
)

func TestLibTVResponseFailuresAreSafeAndDoNotExpireFGLogin(t *testing.T) {
	for _, tc := range []struct {
		status int
		body string
		message string
	}{
		{401, `private-token-do-not-echo`, "登录凭据无效或已过期"},
		{403, `private-token-do-not-echo`, "HTTP 403"},
		{503, `private-token-do-not-echo`, "HTTP 503"},
		{200, `{"code":10001,"msg":"private-token-do-not-echo"}`, "业务码 10001"},
		{200, `{"code":999,"msg":"private-token-do-not-echo"}`, "业务码 999"},
		{200, `<html>private-token-do-not-echo</html>`, "有效的画布数据"},
		{200, `{"code":0,"data":{"projectMeta":{"effective":{"canRead":false,"canCopy":true}}}}`, "没有读取"},
		{200, `{"code":0,"data":{"projectMeta":{"effective":{"canRead":true,"canCopy":false}}}}`, "未开放复制"},
	} {
		_, err := decodeLibTVDetail(tc.status, strings.NewReader(tc.body), "12345678901234567890123456789012")
		var classified *kernel.AppError
		if !errors.As(err, &classified) || classified.Status == http.StatusUnauthorized {
			t.Fatalf("upstream failure must be classified without logging FG out: %v", err)
		}
		if !strings.Contains(classified.Message, tc.message) || strings.Contains(classified.Message, "private-token") {
			t.Fatalf("unexpected or unsafe message: %s", classified.Message)
		}
	}
}

func TestLibTVResponseEnforcesReadAndCopyPermission(t *testing.T) {
	detail, err := decodeLibTVDetail(200, strings.NewReader(`{"code":0,"data":{"projectMeta":{"uuid":"shared","effective":{"canRead":true,"canCopy":true}},"nodeList":[]}}`), "requested")
	if err != nil || detail.ProjectMeta.UUID != "shared" { t.Fatalf("valid response rejected: %v", err) }
	_, err = decodeLibTVDetail(200, strings.NewReader(strings.Repeat("x", libTVMaxResponseBytes+1)), "requested")
	if err == nil || !strings.Contains(err.Error(), "8 MB") { t.Fatalf("oversized response accepted: %v", err) }
}
