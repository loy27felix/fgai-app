package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"meilin/backend/internal/app"
	"meilin/backend/internal/database"
	"meilin/backend/internal/repository"
)

func main() {
	project := flag.String("project", "", "exact production project ID")
	apply := flag.Bool("apply", false, "repair eligible videos; otherwise preview")
	flag.Parse()
	dataDir := os.Getenv("CANVAS_BACKEND_DATA_DIR")
	if strings.TrimSpace(*project) == "" || dataDir == "" || flag.NArg() != 0 {
		log.Fatal("set CANVAS_BACKEND_DATA_DIR and specify -project; pass -apply to write results")
	}
	db, err := database.Open(database.Config{
		Driver: os.Getenv("CANVAS_DATABASE_DRIVER"), DSN: os.Getenv("DATABASE_URL"), DataDir: dataDir,
	})
	if err != nil {
		log.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(2)
	if err := database.RequireSchemaVersion(db); err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	service := app.New(repository.New(db), dataDir)
	defer service.Close()
	report, err := service.RepairDramaMissingFFmpeg(ctx, *project, *apply, os.Stderr)
	if printErr := json.NewEncoder(os.Stdout).Encode(report); printErr != nil {
		log.Fatal(printErr)
	}
	if err != nil {
		log.Fatal(err)
	}
	if report.Failed > 0 || report.Skipped > 0 {
		log.Fatal("some eligible repairs require review")
	}
}
