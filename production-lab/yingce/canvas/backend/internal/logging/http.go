package logging

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"strings"
	"time"

	"yingce/backend/internal/buildinfo"

	"github.com/gin-gonic/gin"
)

// quietWriteSuffixes 是语义上只读、但用 POST 发出的高频路由（心跳、状态查询、批量读取）。
// 与 GET 一样，成功时只在 debug 级别输出。
var quietWriteSuffixes = []string{
	"/heartbeat",
	"/query",
	"/query-provider",
	"/query-task",
	"/checkout/refresh",
	"/assets/batch",
	"/announcements/read",
	"/diagnostics/preview",
	"/system-update/check",
}

const authenticatedUserKey = "logging.authenticated_user"

type authenticatedUser struct {
	id string
}

var supportCorrelationID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,96}$`)

// SetAuthenticatedUser 只能在服务端会话鉴权成功后调用，不能传入 Header 或 URL 中的用户编号。
// Call only after session authentication succeeds; never use a client-supplied user identifier.
func SetAuthenticatedUser(c *gin.Context, userID string) {
	if supportCorrelationID.MatchString(userID) {
		c.Set(authenticatedUserKey, authenticatedUser{id: userID})
	}
}

// AccessLog 替代 gin.Logger：成功的查询类请求（GET/HEAD/OPTIONS 与 quietWriteSuffixes）降为 debug，
// 写请求记 info，4xx 记 warn，5xx 记 error；超过慢请求阈值的非流式请求无论方法都记 warn。
// path 使用路由模板隐藏动态参数，redactPath 可进一步脱敏；未匹配路由不记录原始 URL。
// Use route templates to hide dynamic parameters; never log unmatched raw URLs.
func AccessLog(redactPath func(string) string) gin.HandlerFunc {
	build := buildinfo.Current()
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		latency := time.Since(start)
		status := c.Writer.Status()
		route := c.FullPath()
		level := accessLevel(c.Request.Method, route, status, latency, isStreamResponse(c))
		ctx := c.Request.Context()
		if !slog.Default().Enabled(ctx, level) {
			return
		}
		// 路由参数尚未通过资源归属校验，不能当作已核实 task_id/project_id。
		// Route parameters are not ownership-verified task/project identifiers.
		path := route
		if path == "" {
			path = "/[unmatched]"
		}
		if redactPath != nil {
			path = redactPath(path)
		}
		userID := ""
		if value, exists := c.Get(authenticatedUserKey); exists {
			if user, ok := value.(authenticatedUser); ok {
				userID = user.id
			}
		}
		attrs := []slog.Attr{
			slog.String("build_commit", build.Commit),
			slog.String("build_version", build.Version),
			slog.Any("build_dirty", build.Dirty),
			slog.String("service", "canvas"),
			slog.String("event", "support_http_request"),
			slog.String("user_id", userID),
			slog.String("route", path),
			slog.String("method", c.Request.Method),
			slog.String("path", path),
			slog.Int("status", status),
			slog.Int64("latency_ms", latency.Milliseconds()),
			slog.String("ip", c.ClientIP()),
		}
		// 读取 correlation middleware 的 context，而不是任意客户端 Header。
		// Read the correlation middleware context, not arbitrary client headers.
		for _, field := range []string{"request_id", "trace_id"} {
			if value := c.GetString("canvas." + field); supportCorrelationID.MatchString(value) {
				attrs = append(attrs, slog.String(field, value))
			}
		}
		privateErrors := c.Errors.ByType(gin.ErrorTypePrivate)
		if status >= http.StatusBadRequest || len(privateErrors) > 0 {
			message := http.StatusText(status)
			code := fmt.Sprintf("http_%d", status)
			if status < http.StatusBadRequest || message == "" {
				message = "request handler reported an error"
				code = "handler_error"
			}
			attrs = append(attrs, slog.String("error", message), slog.String("error_code", code))
		}
		if len(privateErrors) > 0 {
			// 错误字符串可能含完整上游正文或凭据；只保留错误类型和 HTTP 摘要。
			// Error strings may contain upstream bodies or secrets; retain types and HTTP summaries only.
			types := make([]string, 0, min(len(privateErrors), 4))
			for _, err := range privateErrors[:min(len(privateErrors), 4)] {
				types = append(types, fmt.Sprintf("%T", err.Err))
			}
			attrs = append(attrs, slog.Int("error_count", len(privateErrors)), slog.Any("error_types", types))
		}
		slog.LogAttrs(ctx, level, "http request", attrs...)
	}
}

func accessLevel(method, route string, status int, latency time.Duration, stream bool) slog.Level {
	switch {
	case status >= http.StatusInternalServerError:
		return slog.LevelError
	case status >= http.StatusBadRequest:
		return slog.LevelWarn
	}
	if threshold := slowRequestThreshold(); threshold > 0 && !stream && latency >= threshold {
		return slog.LevelWarn
	}
	if isQueryRequest(method, route) {
		return slog.LevelDebug
	}
	return slog.LevelInfo
}

func isQueryRequest(method, route string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	case http.MethodPost:
		for _, suffix := range quietWriteSuffixes {
			if strings.HasSuffix(route, suffix) {
				return true
			}
		}
	}
	return false
}

// SSE 与分块下载天然是长连接，耗时不代表慢。
func isStreamResponse(c *gin.Context) bool {
	return strings.Contains(c.Writer.Header().Get("Content-Type"), "text/event-stream")
}

// Recovery 替代 gin.Recovery：panic 与堆栈进入统一日志，而不是直接写带颜色码的 stderr。
func Recovery() gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, recovered any) {
		slog.ErrorContext(c.Request.Context(), "http panic recovered",
			"method", c.Request.Method,
			"route", c.FullPath(),
			"request_id", c.Writer.Header().Get("X-Request-ID"),
			"panic", recovered,
			"stack", string(debug.Stack()),
		)
		c.AbortWithStatus(http.StatusInternalServerError)
	})
}
