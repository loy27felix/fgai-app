package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"meilin/backend/internal/model"
	"meilin/backend/internal/repository"
	"os"
	"path/filepath"
	"time"
)

func (s *Service) FGRecycledCanvases(userID string) ([]model.CanvasProject, error) {
	return s.repo.FGRecycledCanvases(userID)
}
func (s *Service) FGRestoreCanvas(userID, id string) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.FGRestoreCanvas(userID, id)
}

func (s *Service) FGPurgeCanvas(userID, id string) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.FGPurgeCanvas(userID, id, nil, s.archiveFGCanvas)
}

func (s *Service) cleanupExpiredFGCanvases() {
	if os.Getenv("CANVAS_FG_TEAM_WORKSPACE") != "true" {
		return
	}
	cutoff := time.Now().Add(-30 * 24 * time.Hour)
	rows, err := s.repo.FGExpiredRecycledCanvases(cutoff, 20)
	if err != nil {
		return
	}
	for _, row := range rows {
		s.storageMu.Lock()
		// Recheck expiration under the same row lock as restore. A failed NAS
		// archive leaves the canvas recoverable and is retried next hour.
		_ = s.repo.FGPurgeCanvas("", row.ID, &cutoff, s.archiveFGCanvas)
		s.storageMu.Unlock()
	}
}

func (s *Service) archiveFGCanvas(bundle repository.FGCanvasRecycleArchive) error {
	root := os.Getenv("CANVAS_FG_NAS_ROOT")
	if root == "" {
		return errors.New("NAS 回收目录尚未配置，画布仍保留在回收站")
	}
	data, err := json.Marshal(bundle)
	if err != nil {
		return err
	}
	if err := writeFGCanvasArchive(root, bundle.Canvas.UserID, bundle.Canvas.ID, bundle.Canvas.Revision, data); err != nil {
		message := "NAS 回收归档未完成，画布仍保留在回收站，请稍后重试"
		if errors.Is(err, os.ErrPermission) {
			message = "NAS recycle/canvases 没有写入权限，画布仍保留在回收站；请 NAS 管理员开放该子目录的读写权限"
		}
		return WrapAppError(503, message, err)
	}
	return nil
}

func writeFGCanvasArchive(root, owner, id string, revision int64, data []byte) error {
	return writeFGArchive(root, "canvases", owner, id, revision, data)
}

func writeFGArchive(root, collection, owner, id string, revision int64, data []byte) error {
	if root == "" {
		return errors.New("NAS 回收目录尚未配置，原内容仍保留")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil || resolved != root {
		return errors.New("NAS 回收目录尚未挂载或路径无效")
	}
	marker, err := os.Stat(filepath.Join(root, "media", ".fg-studio-nas-ready"))
	if err != nil || !marker.Mode().IsRegular() {
		return errors.New("NAS 尚未就绪，画布仍保留在回收站")
	}
	current := root
	for _, part := range []string{"recycle", collection} {
		current = filepath.Join(current, part)
		if err := os.Mkdir(current, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("NAS 回收路径无效，未移动工程")
		}
	}
	identity := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%d", owner, id, revision)))
	path := filepath.Join(current, hex.EncodeToString(identity[:])+".json")
	if info, err := os.Lstat(path); err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		return errors.New("NAS 回收文件路径无效")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if existing, err := os.ReadFile(path); err == nil {
		if sha256.Sum256(existing) == sha256.Sum256(data) {
			return nil
		}
		return errors.New("NAS 回收目录已有不同内容的工程，未覆盖任何文件")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	file, err := os.CreateTemp(current, ".canvas-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	// The service and row locks serialize all manual and retention writers.
	if err = os.Rename(file.Name(), path); err != nil {
		return err
	}
	return nil
}
