package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"meilin/backend/internal/kernel"
	"net/http"
	"strings"
)

const libTVMaxResponseBytes = 8 << 20

type libTVEnvelope struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
	Msg  string          `json:"msg"`
}

// Only publish our own diagnostics. An upstream response may contain credentials
// or internal data; never expose its message or response body to FG users.
func libTVFailure(status int, code int, message string) *kernel.AppError {
	err := kernel.NewAppError(http.StatusBadGateway, message)
	err.Details = map[string]any{"provider": "libtv", "providerStatus": status, "providerCode": code}
	return err
}

func decodeLibTVDetail(status int, reader io.Reader, projectUUID string) (*libTVDetail, error) {
	if status == http.StatusUnauthorized {
		return nil, libTVFailure(status, 0, "LibTV 登录凭据无效或已过期，请重新登录 LibTV 并更新 Token")
	}
	if status == http.StatusForbidden {
		return nil, libTVFailure(status, 0, "LibTV 拒绝读取，请确认账号对该画布有读取与复制权限（HTTP 403）")
	}
	if status < 200 || status >= 300 {
		return nil, libTVFailure(status, 0, fmt.Sprintf("LibTV 服务请求失败（HTTP %d），请稍后重试", status))
	}
	body, err := io.ReadAll(io.LimitReader(reader, libTVMaxResponseBytes+1))
	if err != nil {
		return nil, kernel.WrapAppError(http.StatusBadGateway, "读取 LibTV 响应失败，请重试", err)
	}
	if len(body) > libTVMaxResponseBytes {
		return nil, libTVFailure(status, 0, "LibTV 画布数据超过 8 MB，请拆分画布后导入")
	}
	var envelope libTVEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, libTVFailure(status, 0, "LibTV 未返回有效的画布数据，请稍后重试")
	}
	if envelope.Code != 0 {
		if envelope.Code == 10001 {
			return nil, libTVFailure(status, envelope.Code, "LibTV 未授权此请求（业务码 10001），请重新登录 LibTV 并更新 Token")
		}
		return nil, libTVFailure(status, envelope.Code, fmt.Sprintf("LibTV 拒绝读取画布（业务码 %d），请确认 UUID 和账号权限", envelope.Code))
	}
	var detail libTVDetail
	if err := json.Unmarshal(envelope.Data, &detail); err != nil {
		return nil, libTVFailure(status, 0, "LibTV 画布数据格式无效，请确认分享链接仍可访问")
	}
	if strings.TrimSpace(detail.ProjectMeta.UUID) == "" {
		detail.ProjectMeta.UUID = projectUUID
	}
	if !detail.ProjectMeta.Effective.CanRead {
		return nil, kernel.Forbidden("当前 LibTV 账号没有读取此画布的权限，请在 LibTV 确认分享权限")
	}
	if !detail.ProjectMeta.Effective.CanCopy {
		return nil, kernel.Forbidden("当前 LibTV 画布未开放复制，请让画布所有者在 LibTV 开启允许复制")
	}
	return &detail, nil
}
