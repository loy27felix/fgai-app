package storage

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"

	"meilin/backend/internal/kernel"
)

// CheckNASGuard consumes the supervisor's local guard, not a potentially stale NAS marker.
// 读取守护进程的本地守卫，不用可能仍可读取的 NAS 标记代替实时故障保护。
func CheckNASGuard() error {
	directory, configured := os.LookupEnv("CANVAS_NAS_GUARD_DIR")
	if !configured {
		return nil
	}
	unavailable := func(cause error) error {
		err := kernel.WrapAppError(http.StatusServiceUnavailable, "NAS 媒体存储当前不可用，请等待挂载恢复", cause)
		err.Reason = "nas_unavailable"
		err.Retryable = true
		return err
	}
	if !filepath.IsAbs(directory) {
		return unavailable(errors.New("NAS guard directory must be absolute"))
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return unavailable(err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return unavailable(errors.New("NAS guard directory is not a regular directory"))
	}
	_, err = os.Lstat(filepath.Join(directory, "disabled"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err == nil {
		err = errors.New("NAS supervisor guard is active")
	}
	return unavailable(err)
}
