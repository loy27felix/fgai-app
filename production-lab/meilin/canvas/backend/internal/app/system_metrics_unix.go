//go:build linux || darwin

package app

import (
	"os"
	"path/filepath"
	"syscall"
)

func collectSystemDisk(path string) SystemPerformanceDisk {
	if path == "" {
		path = "."
	}
	path, _ = filepath.Abs(path)
	writable := false
	if file, err := os.CreateTemp(path, ".system-performance-write-check-"); err == nil {
		writable = true
		name := file.Name()
		_ = file.Close()
		_ = os.Remove(name)
	}
	var stats syscall.Statfs_t
	if err := syscall.Statfs(path, &stats); err != nil {
		return SystemPerformanceDisk{Writable: writable}
	}
	blockSize := uint64(stats.Bsize)
	// A Docker SMB/virtiofs mount can report inconsistent free counts. Do not
	// subtract unsigned integers before validation or present wrapped capacity.
	if stats.Bsize <= 0 || stats.Blocks == 0 || stats.Bfree > stats.Blocks || stats.Bavail > stats.Blocks || stats.Blocks > ^uint64(0)/blockSize {
		return SystemPerformanceDisk{Writable: writable}
	}
	total := stats.Blocks * blockSize
	free := stats.Bavail * blockSize
	used := total - stats.Bfree*blockSize
	usage := float64(0)
	if total > 0 {
		usage = float64(used) / float64(total) * 100
	}
	return SystemPerformanceDisk{Available: true, Writable: writable, TotalBytes: total, UsedBytes: used, FreeBytes: free, UsagePercent: usage}
}
