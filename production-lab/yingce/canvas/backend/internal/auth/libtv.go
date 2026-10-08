package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"

	"gorm.io/gorm"
)

const (
	libTVSettingKey       = "libtv"
	libTVDetailURL        = "https://api.liblib.tv/api/canvas/project/detail"
	libTVMaxResponseBytes = 8 << 20
)

type LibTVSettingRequest struct {
	Enabled    bool   `json:"enabled"`
	Token      string `json:"token"`
	ClearToken bool   `json:"clearToken"`
}

type PublicLibTVSetting struct {
	Enabled   bool      `json:"enabled"`
	HasToken  bool      `json:"hasToken"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type libTVSettingValue struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
}

type LibTVImportRequest struct {
	UUID string `json:"uuid"`
}

type LibTVImportResult struct {
	BatchID                 string                  `json:"batchId"`
	BatchCreatedAt          time.Time               `json:"batchCreatedAt"`
	ProjectUUID             string                  `json:"projectUuid"`
	ProjectName             string                  `json:"projectName"`
	Nodes                   []LibTVCanvasNode       `json:"nodes"`
	Connections             []LibTVCanvasConnection `json:"connections"`
	ImportedNodeCount       int                     `json:"importedNodeCount"`
	ImportedConnectionCount int                     `json:"importedConnectionCount"`
	SkippedNodes            []LibTVImportIssue      `json:"skippedNodes"`
	SkippedConnections      []LibTVImportIssue      `json:"skippedConnections"`
	Warnings                []LibTVImportWarning    `json:"warnings"`
	MultiResultNodeCount    int                     `json:"multiResultNodeCount"`
	StaleNodeCount          int                     `json:"staleNodeCount"`
	ReusedFailedNodeCount   int                     `json:"reusedFailedNodeCount"`
	PlaceholderNodeCount    int                     `json:"placeholderNodeCount"`
	ConvertedSpecialCount   int                     `json:"convertedSpecialCount"`
}

type LibTVCanvasNode struct {
	ID            string              `json:"id"`
	Type          string              `json:"type"`
	Title         string              `json:"title"`
	X             float64             `json:"x"`
	Y             float64             `json:"y"`
	Width         float64             `json:"width"`
	Height        float64             `json:"height"`
	Content       string              `json:"content"`
	Prompt        string              `json:"prompt,omitempty"`
	Model         string              `json:"model,omitempty"`
	NaturalWidth  int                 `json:"naturalWidth,omitempty"`
	NaturalHeight int                 `json:"naturalHeight,omitempty"`
	DurationMs    int64               `json:"durationMs,omitempty"`
	MimeType      string              `json:"mimeType,omitempty"`
	Status        string              `json:"status,omitempty"`
	ErrorDetails  string              `json:"errorDetails,omitempty"`
	Metadata      LibTVImportMetadata `json:"metadata"`
}

type LibTVImportMetadata struct {
	Provider         string `json:"provider"`
	ProjectUUID      string `json:"projectUuid"`
	NodeKey          string `json:"nodeKey"`
	BatchID          string `json:"batchId"`
	SourceType       string `json:"sourceType,omitempty"`
	StyleAssetUUID   string `json:"styleAssetUuid,omitempty"`
	StyleVersionUUID string `json:"styleVersionUuid,omitempty"`
	StyleName        string `json:"styleName,omitempty"`
}

type LibTVCanvasConnection struct {
	ID         string `json:"id"`
	FromNodeID string `json:"fromNodeId"`
	ToNodeID   string `json:"toNodeId"`
}

type LibTVImportIssue struct {
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Reason string `json:"reason"`
}

type LibTVImportWarning struct {
	ID      string `json:"id,omitempty"`
	Message string `json:"message"`
}

type libTVEnvelope struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
	Msg  string          `json:"msg"`
}

type libTVDetail struct {
	ProjectMeta struct {
		UUID      string `json:"uuid"`
		Name      string `json:"name"`
		Effective struct {
			CanRead bool `json:"canRead"`
			CanCopy bool `json:"canCopy"`
		} `json:"effective"`
	} `json:"projectMeta"`
	NodeList       []libTVRawNode       `json:"nodeList"`
	ConnectionList []libTVRawConnection `json:"connectionList"`
}

type libTVRawNode struct {
	NodeKey  string `json:"nodeKey"`
	Name     string `json:"name"`
	Data     string `json:"data"`
	Position struct {
		X string `json:"positionX"`
		Y string `json:"positionY"`
	} `json:"position"`
	Measured struct {
		Width  string `json:"width"`
		Height string `json:"height"`
	} `json:"measured"`
	TaskInfo struct {
		Status       int    `json:"status"`
		FailedReason string `json:"failedReason"`
	} `json:"taskInfo"`
	IsStale bool `json:"isStale"`
}

type libTVRawConnection struct {
	ConnectionID string `json:"connectionId"`
	Source       string `json:"source"`
	Target       string `json:"target"`
}

type libTVNodeData struct {
	Type             string         `json:"type"`
	URL              []string       `json:"url"`
	CoverURL         string         `json:"coverUrl"`
	StyleAssetUUID   string         `json:"styleAssetUuid"`
	StyleVersionUUID string         `json:"styleVersionUuid"`
	StyleName        string         `json:"styleName"`
	Params           map[string]any `json:"params"`
	TaskInfo         struct {
		Status       int    `json:"status"`
		FailedReason string `json:"failedReason"`
	} `json:"taskInfo"`
	IsStale      bool `json:"isStale"`
	ResourceMeta struct {
		Items []struct {
			Width       int     `json:"width"`
			Height      int     `json:"height"`
			DurationSec float64 `json:"durationSec"`
		} `json:"items"`
	} `json:"_resourceMeta"`
}

func (s *Service) AdminLibTVSetting(actor *model.User) (*PublicLibTVSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	return publicLibTVSetting(setting, value), nil
}

func (s *Service) UpdateLibTVSetting(actor *model.User, req LibTVSettingRequest) (*PublicLibTVSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, current, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(req.Token)
	if req.ClearToken {
		token = ""
	} else if token == "" {
		token = current.Token
	}
	if req.Enabled && token == "" {
		return nil, kernel.BadAuthRequest("启用 LibTV 前请先配置 Token")
	}
	protected, err := s.host.EncryptSecret(token)
	if err != nil {
		return nil, err
	}
	valueJSON, err := json.Marshal(libTVSettingValue{Enabled: req.Enabled, Token: protected})
	if err != nil {
		return nil, err
	}
	setting := &model.SystemSetting{Key: libTVSettingKey, ValueJSON: string(valueJSON), UpdatedBy: actor.ID}
	if existing, lookupErr := s.repo.SystemSetting(libTVSettingKey); lookupErr == nil {
		setting.CreatedAt = existing.CreatedAt
	} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return nil, lookupErr
	}
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return nil, err
	}
	return publicLibTVSetting(setting, libTVSettingValue{Enabled: req.Enabled, Token: token}), nil
}

func (s *Service) TestLibTV(actor *model.User, projectUUID string) error {
	if actor == nil {
		return kernel.Unauthorized("请先登录")
	}
	if err := s.host.RequireAdmin(actor); err != nil {
		return err
	}
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return err
	}
	if value.Token == "" {
		return kernel.BadAuthRequest("尚未配置 LibTV Token")
	}
	_, err = s.fetchLibTVDetail(strings.TrimSpace(projectUUID), value.Token)
	return err
}

func (s *Service) ImportLibTV(userID, canvasProjectID, projectUUID string) (*LibTVImportResult, error) {
	userID = strings.TrimSpace(userID)
	canvasProjectID = strings.TrimSpace(canvasProjectID)
	if userID == "" || canvasProjectID == "" {
		return nil, kernel.Unauthorized("请先打开已同步的" + s.host.BrandName() + "画布")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, canvasProjectID); err != nil {
		return nil, err
	}
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	if !value.Enabled || value.Token == "" {
		return nil, kernel.BadAuthRequest("LibTV 尚未启用或未配置 Token")
	}
	detail, err := s.fetchLibTVDetail(strings.TrimSpace(projectUUID), value.Token)
	if err != nil {
		return nil, err
	}
	return adaptLibTVDetail(detail)
}

func (s *Service) readLibTVSetting() (*model.SystemSetting, libTVSettingValue, error) {
	setting, err := s.repo.SystemSetting(libTVSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, libTVSettingValue{}, nil
	}
	if err != nil {
		return nil, libTVSettingValue{}, err
	}
	value := libTVSettingValue{}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return nil, value, errors.New("LibTV 配置格式无效")
	}
	if value.Token != "" {
		plain, err := s.host.DecryptSecret(value.Token)
		if err != nil {
			return nil, value, err
		}
		value.Token = plain
	}
	return setting, value, nil
}

func publicLibTVSetting(setting *model.SystemSetting, value libTVSettingValue) *PublicLibTVSetting {
	result := &PublicLibTVSetting{Enabled: value.Enabled, HasToken: strings.TrimSpace(value.Token) != ""}
	if setting != nil {
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func (s *Service) fetchLibTVDetail(projectUUID, token string) (*libTVDetail, error) {
	projectUUID = strings.TrimSpace(projectUUID)
	if !isLibTVProjectUUID(projectUUID) {
		return nil, kernel.BadAuthRequest("LibTV 画布 UUID 格式无效")
	}
	u, err := url.Parse(libTVDetailURL)
	if err != nil {
		return nil, err
	}
	query := u.Query()
	query.Set("uuid", projectUUID)
	u.RawQuery = query.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("token", token)
	outbound.ApplyDefaultOutboundHeaders(req)
	client := outbound.OutboundHTTPClient(20 * time.Second)
	// Token 是 LibTV 专用凭证，禁止重定向以避免自定义请求头被带到其他主机。
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("LibTV API 不允许重定向")
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, kernel.WrapAppError(http.StatusBadGateway, "无法连接 LibTV，请检查服务器网络后重试", err)
	}
	defer resp.Body.Close()
	return decodeLibTVDetail(resp.StatusCode, resp.Body, projectUUID)
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
