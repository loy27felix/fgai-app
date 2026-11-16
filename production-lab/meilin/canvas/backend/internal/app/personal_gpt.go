package app

import (
	"encoding/json"
	"errors"
	"meilin/backend/internal/model"
	"net/url"
	"strings"
)

const personalGPTDefaultURL = "https://api.ten-rings.adtensor.com/llm/v1"
const personalGPTChannelName = "Trings · 个人 GPT"

type personalGPTCredential struct {
	BaseURL   string `json:"baseUrl"`
	KeyCipher string `json:"keyCipher"`
}
type PersonalGPTView struct {
	BaseURL         string `json:"baseUrl"`
	Configured      bool   `json:"configured"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort"`
}

func personalGPTSettingKey(userID string) string { return "fg.personal-gpt:" + userID }
func (s *Service) personalGPTCredential(userID string) (personalGPTCredential, error) {
	value := personalGPTCredential{BaseURL: personalGPTDefaultURL}
	setting, err := s.repo.SystemSettingOptional(personalGPTSettingKey(userID))
	if err != nil {
		return value, err
	}
	if setting != nil {
		err = json.Unmarshal([]byte(setting.ValueJSON), &value)
	}
	return value, err
}
func (s *Service) PersonalGPT(userID string) (*PersonalGPTView, error) {
	value, err := s.personalGPTCredential(userID)
	if err != nil {
		return nil, err
	}
	return &PersonalGPTView{BaseURL: value.BaseURL, Configured: value.KeyCipher != "", Model: "gpt-6.1-sol", ReasoningEffort: "high"}, nil
}
func (s *Service) SavePersonalGPT(userID, baseURL, key string) (*PersonalGPTView, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	key = strings.TrimSpace(key)
	if baseURL == "" {
		baseURL = personalGPTDefaultURL
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(baseURL) > 2048 {
		return nil, BadAuthRequest("API URL 须为不含账号、查询参数的 HTTPS 接口根地址")
	}
	if _, err := ValidateOutboundURL(baseURL); err != nil {
		return nil, BadAuthRequest("API URL 不是可访问的公共 HTTPS 地址")
	}
	if len(key) > 8192 || strings.ContainsAny(key, "\r\n") {
		return nil, BadAuthRequest("API Key 格式无效")
	}
	old, err := s.personalGPTCredential(userID)
	if err != nil {
		return nil, err
	}
	if key == "" && (old.KeyCipher == "" || old.BaseURL != baseURL) {
		return nil, BadAuthRequest("首次配置或更换 API URL 时请填写 API Key")
	}
	cipher := old.KeyCipher
	if key != "" {
		cipher, err = s.encryptSettingSecret(key)
		if err != nil {
			return nil, err
		}
	}
	data, err := json.Marshal(personalGPTCredential{BaseURL: baseURL, KeyCipher: cipher})
	if err != nil {
		return nil, err
	}
	if err = s.repo.SaveSystemSetting(&model.SystemSetting{Key: personalGPTSettingKey(userID), ValueJSON: string(data), UpdatedBy: userID}); err != nil {
		return nil, err
	}
	return s.PersonalGPT(userID)
}
func (s *Service) DeletePersonalGPT(userID string) error {
	return s.repo.DeleteSystemSetting(personalGPTSettingKey(userID))
}
func (s *Service) personalGPTProvider(config providerConfig, userID string) (providerConfig, error) {
	if config.Model != "gpt-6.1-sol" || config.ChannelID == "" {
		return config, nil
	}
	// Only a server-owned catalog route opts in. Never take an owner or key from
	// task input, browser storage, or the model's tool arguments.
	channel, err := s.SystemChannel(config.ChannelID)
	if err != nil {
		return providerConfig{}, err
	}
	if channel.Name != personalGPTChannelName {
		return config, nil
	}
	value, err := s.personalGPTCredential(userID)
	if err != nil {
		return providerConfig{}, err
	}
	if value.KeyCipher == "" {
		return providerConfig{}, BadAuthRequest("请先在个人设置 → GPT 接入中填写自己的 Trings API URL 和 API Key")
	}
	key, err := s.decryptSettingSecret(value.KeyCipher)
	if err != nil {
		return providerConfig{}, errors.New("个人 GPT Key 暂时无法读取，请重新保存配置")
	}
	if _, err = ValidateOutboundURL(value.BaseURL); err != nil {
		return providerConfig{}, BadAuthRequest("个人 GPT API URL 已不可用，请检查个人设置")
	}
	config.BaseURL = value.BaseURL
	config.APIKey = key
	config.SecretKey = ""
	config.Headers = nil
	return config, nil
}

// Synchronous proxy and queued generation resolve the same authenticated
// owner's credentials. The channel copy is never written back to the catalog.
func (s *Service) SystemChannelForUser(userID, channelID string) (*model.ModelChannel, error) {
	channel, err := s.SystemChannel(channelID)
	if err != nil || channel.Name != personalGPTChannelName {
		return channel, err
	}
	config, err := s.personalGPTProvider(providerConfig{Model: "gpt-6.1-sol", ChannelID: channelID}, userID)
	if err != nil {
		return nil, err
	}
	copy := *channel
	copy.BaseURL, copy.APIKey, copy.SecretKey, copy.HeadersJSON = config.BaseURL, config.APIKey, "", "[]"
	return &copy, nil
}

func (s *Service) PersonalGPTProxyDefaults(channel *model.ModelChannel, body []byte) ([]byte, error) {
	if channel.Name != personalGPTChannelName || len(body) == 0 {
		return body, nil
	}
	var request map[string]any
	if json.Unmarshal(body, &request) != nil {
		return nil, BadAuthRequest("GPT 请求必须是 JSON 对象")
	}
	if request["model"] == "gpt-6.1-sol" {
		request["reasoning_effort"] = "high"
	}
	return json.Marshal(request)
}
func (s *Service) requirePersonalGPTForTask(userID string, input map[string]any) error {
	config, _ := input["config"].(map[string]any)
	if config == nil {
		return nil
	}
	modelKey, _ := config["model"].(string)
	if modelKey != "gpt-6.1-sol" {
		return nil
	}
	channelID, _ := config["channelId"].(string)
	if channelID == "" {
		return nil
	}
	channel, err := s.SystemChannel(channelID)
	if err != nil {
		return err
	}
	if channel.Name != personalGPTChannelName {
		return nil
	}
	value, err := s.personalGPTCredential(userID)
	if err != nil {
		return err
	}
	if value.KeyCipher == "" {
		return BadAuthRequest("请先在个人设置 → GPT 接入中填写自己的 Trings API URL 和 API Key")
	}
	return nil
}
