package buildinfo

import (
	"runtime"
	"runtime/debug"
	"strings"
)

var (
	Version   = "dev"
	Commit    = "unknown"
	BuildTime = "unknown"
	Dirty     = "unknown"
)

type Info struct {
	Version     string `json:"version"`
	Commit      string `json:"commit"`
	BuildTime   string `json:"buildTime"`
	GoVersion   string `json:"goVersion"`
	Environment string `json:"environment"`
	Dirty       *bool  `json:"dirty"`
}

func Current() Info {
	version := normalized(Version, "dev")
	commit := normalized(Commit, "unknown")
	buildTime := normalized(BuildTime, "unknown")
	var dirty *bool
	if Dirty == "true" || Dirty == "false" {
		value := Dirty == "true"
		dirty = &value
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range info.Settings {
			switch setting.Key {
			case "vcs.modified":
				if dirty == nil || setting.Value == "true" {
					value := setting.Value == "true"
					dirty = &value
				}
			case "vcs.revision":
				if commit == "unknown" {
					commit = normalized(setting.Value, commit)
				}
			case "vcs.time":
				if buildTime == "unknown" {
					buildTime = normalized(setting.Value, buildTime)
				}
			}
		}
	}
	environment := "production"
	if version == "dev" || version == "development" || version == "unknown" {
		environment = "development"
	}
	return Info{Version: version, Commit: commit, BuildTime: buildTime, GoVersion: runtime.Version(), Environment: environment, Dirty: dirty}
}

func normalized(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
