"""Isolated SQLite schema shared by the FG integration regression suite."""
from pathlib import Path
import shutil

import pytest
from app.persistence.database import create_v2_database, resolve_v2_database_path
from app.persistence.schema import upgrade_v2_schema


@pytest.fixture(scope="session")
def _empty_v2_schema(tmp_path_factory):
    root = tmp_path_factory.mktemp("fg-empty-v2")
    path = resolve_v2_database_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    database = create_v2_database(root)
    try:
        upgrade_v2_schema(database)
    finally:
        database.dispose()
    return path


@pytest.fixture
def v2_media_data_dir(tmp_path: Path, _empty_v2_schema: Path):
    root = tmp_path / "media"
    path = resolve_v2_database_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(_empty_v2_schema, path)
    return root
