package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFGCanvasArchiveRequiresNASAndPreservesExistingFile(t *testing.T) {
	root := t.TempDir()
	if err := writeFGCanvasArchive(root, "owner", "../../outside", 1, []byte("document")); err == nil {
		t.Fatal("unmounted NAS accepted")
	}
	if err := os.Mkdir(filepath.Join(root, "media"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "media", ".fg-studio-nas-ready"), []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := writeFGCanvasArchive(root, "owner", "../../outside", 1, []byte("document")); err != nil {
			t.Fatal(err)
		}
	}
	files, err := filepath.Glob(filepath.Join(root, "recycle", "canvases", "*.json"))
	if err != nil || len(files) != 1 {
		t.Fatal(files, err)
	}
	if err := writeFGCanvasArchive(root, "owner", "../../outside", 1, []byte("replacement")); err == nil {
		t.Fatal("different archive overwritten")
	}
	actual, err := os.ReadFile(files[0])
	if err != nil || string(actual) != "document" {
		t.Fatal("original archive changed", err)
	}
	if err := os.Remove(files[0]); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "media", ".fg-studio-nas-ready"), files[0]); err != nil {
		t.Skip("symlink privileges unavailable")
	}
	if err := writeFGCanvasArchive(root, "owner", "../../outside", 1, []byte("replacement")); err == nil {
		t.Fatal("symlink archive accepted")
	}
}

func TestFGCanvasArchiveRejectsSymlinkRecycleDirectory(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "media"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "media", ".fg-studio-nas-ready"), []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "recycle")); err != nil {
		t.Skip("symlink privileges unavailable")
	}
	if err := writeFGCanvasArchive(root, "owner", "canvas", 1, []byte("document")); err == nil {
		t.Fatal("external recycle path accepted")
	}
	files, _ := os.ReadDir(outside)
	if len(files) != 0 {
		t.Fatal("external path changed")
	}
}
