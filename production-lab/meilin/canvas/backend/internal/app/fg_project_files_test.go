package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestFGProjectFilesArchiveRestoreAndIsolation(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	root := t.TempDir()
	t.Setenv("CANVAS_FG_NAS_ROOT", root)
	actor := "70f9ee5d-510d-4bfd-a46e-6eec2a23a2b8"
	other := "87454cb3-0e81-4b50-9943-7a5b1161a3ff"
	op := "01234567890123456789012345678901"
	s, _ := newProjectDeleteTestService(t)
	work := filepath.Join(root, "media", "arcreel", "users", actor)
	rec := filepath.Join(root, "recycle", "arcreel", actor)
	for _, p := range []string{work, rec} {
		if e := os.MkdirAll(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	os.WriteFile(filepath.Join(root, "media", ".fg-studio-nas-ready"), []byte("ready"), 0600)
	os.WriteFile(filepath.Join(rec, ".fg-recycle-ready"), []byte("FG actor recycle v1\n"), 0600)
	source := filepath.Join(work, "project")
	os.Mkdir(source, 0700)
	os.WriteFile(filepath.Join(source, "video.mp4"), []byte("actual media"), 0600)
	if _, e := s.FGProjectFiles(other, "arcreel", "archive", "project", op, nil); e == nil {
		t.Fatal("cross actor archive accepted")
	}
	if _, e := s.FGProjectFiles(actor, "arcreel", "archive", "../project", op, nil); e == nil {
		t.Fatal("traversal accepted")
	}
	if _, e := s.FGProjectFiles(actor, "arcreel", "archive", "project", op, json.RawMessage(`{"name":"project"}`)); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(source); !os.IsNotExist(e) {
		t.Fatal("original remained", e)
	}
	if _, e := s.FGProjectFiles(actor, "arcreel", "archive", "project", op, nil); e != nil {
		t.Fatal("archive receipt retry failed", e)
	}
	data, e := os.ReadFile(filepath.Join(rec, op, "video.mp4"))
	if e != nil || string(data) != "actual media" {
		t.Fatal("archive damaged", e)
	}
	if _, e = s.FGProjectFiles(actor, "arcreel", "restore", "wrong", op, nil); e == nil {
		t.Fatal("mismatched restore accepted")
	}
	if _, e = s.FGProjectFiles(actor, "arcreel", "restore", "project", op, nil); e != nil {
		t.Fatal(e)
	}
	if data, e = os.ReadFile(filepath.Join(source, "video.mp4")); e != nil || string(data) != "actual media" {
		t.Fatal("restore damaged", e)
	}
}

func TestFGResourceDeleteArchivesBytesAndRequiresNAS(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	root := t.TempDir()
	t.Setenv("CANVAS_FG_NAS_ROOT", root)
	s, _ := newProjectDeleteTestService(t)
	s.dataDir = filepath.Join(root, "media")
	resources := filepath.Join(s.dataDir, "resources")
	os.MkdirAll(resources, 0700)
	target := filepath.Join(resources, "test.mp4")
	os.WriteFile(target, []byte("media bytes"), 0600)
	if e := s.deleteLocalResourceObject("test.mp4"); e == nil {
		t.Fatal("unready NAS accepted")
	}
	if _, e := os.Stat(target); e != nil {
		t.Fatal("original lost", e)
	}
	os.WriteFile(filepath.Join(s.dataDir, ".fg-studio-nas-ready"), []byte("ready"), 0600)
	if e := s.deleteLocalResourceObject("test.mp4"); e != nil {
		t.Fatal(e)
	}
	files, e := filepath.Glob(filepath.Join(root, "recycle", "resources", "*.bin"))
	if e != nil || len(files) != 1 {
		t.Fatal(files, e)
	}
	data, e := os.ReadFile(files[0])
	if e != nil || string(data) != "media bytes" {
		t.Fatal("archive damaged", e)
	}
	if _, e = os.Stat(target); !os.IsNotExist(e) {
		t.Fatal("original remained", e)
	}
	if e = s.deleteLocalResourceObject("test.mp4"); e != nil {
		t.Fatal("outbox retry is not idempotent", e)
	}
}

func TestFGResourceDeleteUsesNestedCanvasDataDirectory(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	root := t.TempDir()
	t.Setenv("CANVAS_FG_NAS_ROOT", root)
	s, _ := newProjectDeleteTestService(t)
	s.dataDir = filepath.Join(root, "media", "yingce")
	resources := filepath.Join(s.dataDir, "resources", "users", "fixture")
	if err := os.MkdirAll(resources, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "media", ".fg-studio-nas-ready"), []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(resources, "test.mp4")
	if err := os.WriteFile(source, []byte("nested canvas media"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.deleteLocalResourceObject("users/fixture/test.mp4"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatal("original remained", err)
	}
	files, err := filepath.Glob(filepath.Join(root, "recycle", "resources", "*.bin"))
	if err != nil || len(files) != 1 {
		t.Fatal(files, err)
	}
	if body, err := os.ReadFile(files[0]); err != nil || string(body) != "nested canvas media" {
		t.Fatal("nested archive damaged", err)
	}
}
