package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
)

var fgActorID = regexp.MustCompile(`^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)
var fgArchiveID = regexp.MustCompile(`^[0-9a-f]{32}$`)

func (s *Service) FGArchiveStory(actor string, id int, revision int64, data json.RawMessage) error {
	if !s.repo.FGIsAdministrator(actor) {
		return Forbidden("仅管理员可归档故事")
	}
	if id <= 0 || revision < 0 || !json.Valid(data) {
		return BadAuthRequest("故事归档内容无效")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return writeFGArchive(os.Getenv("CANVAS_FG_NAS_ROOT"), "stories", actor, fmt.Sprint(id), revision, data)
}

// Actor runtimes retain only their private bind mounts. The trusted backend
// accepts names, never caller paths, and moves within its existing NAS mount.
func (s *Service) FGProjectFiles(actor, module, action, name, operation string, record json.RawMessage) (string, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if os.Getenv("CANVAS_FG_TEAM_WORKSPACE") != "true" || !fgActorID.MatchString(actor) || !fgArchiveID.MatchString(operation) {
		return "", Forbidden("工程归档未授权")
	}
	if module != "arcreel" && module != "opencreator" {
		return "", BadAuthRequest("工程类型无效")
	}
	if name == "" || len(name) > 240 || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "/\\\x00") || filepath.Base(name) != name {
		return "", BadAuthRequest("工程目录名称无效")
	}
	if action != "archive" && action != "restore" {
		return "", BadAuthRequest("工程归档操作无效")
	}
	root := os.Getenv("CANVAS_FG_NAS_ROOT")
	if root == "" {
		return "", errors.New("NAS 归档路径尚未配置")
	}
	if info, err := os.Stat(filepath.Join(root, "media", ".fg-studio-nas-ready")); err != nil || !info.Mode().IsRegular() {
		return "", errors.New("NAS 尚未就绪，原工程仍保留")
	}
	workspace := filepath.Join(root, "media", module, "users", actor)
	recycle := filepath.Join(root, "recycle", module, actor)
	for _, p := range []string{workspace, recycle} {
		resolved, err := filepath.EvalSymlinks(p)
		if err != nil || resolved != p {
			return "", errors.New("工程或回收路径无效，原工程仍保留")
		}
	}
	marker, err := os.ReadFile(filepath.Join(recycle, ".fg-recycle-ready"))
	if err != nil || string(marker) != "FG actor recycle v1\n" {
		return "", errors.New("NAS 回收标记无效")
	}
	source, destination := filepath.Join(workspace, name), filepath.Join(recycle, operation)
	manifest := filepath.Join(recycle, operation+".json")
	if action == "restore" {
		data, e := os.ReadFile(manifest)
		if e != nil {
			return "", e
		}
		var m struct {
			Actor, Module, Name, Operation string
			Files                          map[string]string
		}
		if json.Unmarshal(data, &m) != nil || m.Actor != actor || m.Module != module || m.Name != name || m.Operation != operation {
			return "", Forbidden("归档不属于当前工程")
		}
		if _, e = os.Lstat(source); e == nil {
			return "", errors.New("原目录已存在，未覆盖任何工程")
		} else if !errors.Is(e, os.ErrNotExist) {
			return "", e
		}
		info, e := os.Lstat(destination)
		if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("归档目录无效")
		}
		inventory, e := fgDirectoryInventory(destination)
		if e != nil || !reflect.DeepEqual(inventory, m.Files) {
			return "", errors.New("归档校验不符，文件仍保留在 recycle")
		}
		if e = os.Rename(destination, source); e != nil {
			return "", e
		}
		return operation, nil
	}
	if _, e := os.Lstat(destination); e == nil {
		data, readErr := os.ReadFile(manifest)
		var m struct {
			Actor, Module, Name, Operation string
			Files                          map[string]string
		}
		if readErr != nil || json.Unmarshal(data, &m) != nil || m.Actor != actor || m.Module != module || m.Name != name || m.Operation != operation {
			return "", errors.New("归档标识已存在，未覆盖文件")
		}
		if _, sourceErr := os.Lstat(source); !errors.Is(sourceErr, os.ErrNotExist) {
			return "", errors.New("原目录与归档同时存在，请检查工程")
		}
		inventory, checkErr := fgDirectoryInventory(destination)
		if checkErr != nil || !reflect.DeepEqual(inventory, m.Files) {
			return "", errors.New("归档校验不符，未修改任何文件")
		}
		return operation, nil
	} else if !errors.Is(e, os.ErrNotExist) {
		return "", e
	}
	info, err := os.Lstat(source)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("只允许归档本人托管工程目录")
	}
	before, err := fgDirectoryInventory(source)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(map[string]any{"Actor": actor, "Module": module, "Name": name, "Operation": operation, "files": before, "record": record})
	if err != nil {
		return "", err
	}
	f, err := os.OpenFile(manifest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	// Same bind mount: no EXDEV or recursive SMB deferred unlink.
	if err = os.Rename(source, destination); err != nil {
		return "", err
	}
	after, err := fgDirectoryInventory(destination)
	if err != nil || !reflect.DeepEqual(before, after) {
		if restoreErr := os.Rename(destination, source); restoreErr != nil {
			return "", fmt.Errorf("归档校验失败；完整工程保留在 recycle，恢复未完成: %w", restoreErr)
		}
		return "", errors.New("归档校验失败，已保留原工程")
	}
	return operation, nil
}

// Local resource deletion uses the same NAS-root bind as the destination. The
// /data alias may be a separate Docker bind and cannot be renamed across mounts.
func (s *Service) recycleFGResource(objectKey, relative, target string) error {
	root := os.Getenv("CANVAS_FG_NAS_ROOT")
	if root == "" {
		return errors.New("NAS 回收目录未配置，素材删除任务等待重试")
	}
	// /data is the existing media bind mount; production keeps native canvas
	// data in /data/yingce. Move through the NAS root mount to avoid SMB unlink.
	dataRelative, err := filepath.Rel(filepath.Join(root, "media"), s.dataDir)
	if err != nil || dataRelative == ".." || strings.HasPrefix(dataRelative, ".."+string(filepath.Separator)) {
		dataRelative, err = filepath.Rel("/data", s.dataDir)
	}
	if err != nil || dataRelative == ".." || strings.HasPrefix(dataRelative, ".."+string(filepath.Separator)) || filepath.IsAbs(dataRelative) {
		return errors.New("NAS 素材数据目录不在 media 挂载内，文件仍保留")
	}
	source := filepath.Join(root, "media", dataRelative, "resources", relative)
	if resolved, e := filepath.EvalSymlinks(source); e != nil || resolved != source {
		return errors.New("NAS 素材真实路径无效，文件仍保留")
	}
	a, err := os.Lstat(target)
	if err != nil {
		return err
	}
	b, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !a.Mode().IsRegular() || !b.Mode().IsRegular() || !os.SameFile(a, b) {
		return errors.New("NAS 素材挂载与资源目录不一致，文件仍保留")
	}
	f, err := os.Open(source)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(h, f)
	f.Close()
	if err != nil {
		return err
	}
	digest := hex.EncodeToString(h.Sum(nil))
	identity := sha256.Sum256([]byte(objectKey + "\x00" + digest))
	id := hex.EncodeToString(identity[:])
	data, _ := json.Marshal(map[string]any{"objectKey": objectKey, "sha256": digest, "bytes": b.Size()})
	if err = writeFGArchive(root, "resources", "", id, 0, data); err != nil {
		return err
	}
	destination := filepath.Join(root, "recycle", "resources", id+".bin")
	if _, err = os.Lstat(destination); err == nil {
		return errors.New("素材回收目标已存在，未覆盖任何文件")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err = os.Rename(source, destination); err != nil {
		return fmt.Errorf("素材 NAS 回收移动失败，等待重试: %w", err)
	}
	return nil
}

func fgDirectoryInventory(root string) (map[string]string, error) {
	result := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == root {
			return nil
		}
		relative, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			target, e := os.Readlink(p)
			result[relative] = "link:" + target
			return e
		}
		if d.IsDir() {
			result[relative] = "directory"
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("工程包含不支持归档的特殊文件")
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, readErr := io.Copy(hash, f)
		closeErr := f.Close()
		if readErr != nil {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		result[relative] = hex.EncodeToString(hash.Sum(nil))
		return nil
	})
	return result, err
}
