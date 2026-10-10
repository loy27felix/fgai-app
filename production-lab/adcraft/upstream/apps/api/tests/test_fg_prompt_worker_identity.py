"""Durable prompt preparation keeps the actor who accepted the work."""

from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import insert

import app.fg_context as identity
from app.persistence.agent_canvas_prompt_preparation_dispatch_repository import (
    AgentCanvasPromptPreparationDispatchRepository,
    normalize_queued_node,
)
from app.persistence.database import create_v2_database
from app.persistence.event_repository import EventRepository
from app.persistence.models import AgentCanvasNodeRow, AgentCanvasWorkflowRow, ProjectRow
from app.schemas.agent_canvas import CanvasNodeV2
from app.schemas.agent_canvas_progressive_authoring import StageAuthoringContextV1
from app.schemas.agent_canvas_prompt_preparation import NodePromptPreparationV1
from app.services.agent_canvas_prompt_preparation_worker import AgentCanvasPromptPreparationWorker
from app.services.agent_canvas_prompt_preparation import context_digest


@pytest.fixture
def prompt_dispatch(v2_media_data_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Redirect only the NAS boundary; attribution is really written and read.
    monkeypatch.setattr(identity, "Path", lambda _: tmp_path / "attribution")
    database = create_v2_database(v2_media_data_dir)
    now = datetime.now(timezone.utc)
    context = StageAuthoringContextV1(
        workflow_id="workflow", session_id="session", session_revision=1,
        stage="product", internal_skill_ref="product-designer",
        creative_goal={"requested_output": "image", "delivery_scope": "draft", "summary": "Cup"},
    )
    node = CanvasNodeV2(
        node_id="product-image", workflow_id="workflow", node_type="image",
        creative_role="product", title="Cup", status="draft", revision=1,
        position={"x": 0, "y": 0}, created_at=now, updated_at=now,
        prompt_preparation=NodePromptPreparationV1(
            status="queued", operation_id="prepare-cup", attempt_no=0, updated_at=now,
        ),
    )
    node = normalize_queued_node(node, context_digest=context_digest(context))
    with database.engine.begin() as connection:
        connection.execute(insert(ProjectRow).values(
            project_id="project", name="Cup", created_at=now.isoformat(),
            updated_at=now.isoformat(),
        ))
        connection.execute(insert(AgentCanvasWorkflowRow).values(
            workflow_id=node.workflow_id, project_id="project",
            created_at=now.isoformat(), updated_at=now.isoformat(),
        ))
        connection.execute(insert(AgentCanvasNodeRow).values(
            node_id=node.node_id, workflow_id=node.workflow_id, node_type=node.node_type,
            creative_role=node.creative_role, title=node.title, status=node.status,
            structured_content_json="{}", parameters_json="{}", position_x=0, position_y=0,
            prompt_preparation_json=node.prompt_preparation.model_dump_json(),
            created_at=now.isoformat(), updated_at=now.isoformat(),
        ))
    repository = AgentCanvasPromptPreparationDispatchRepository(database, EventRepository(database))
    try:
        yield repository, node, context
    finally:
        database.dispose()


@pytest.mark.parametrize("polling_actor", [None, "another-collaborator"])
def test_prompt_worker_restores_accepted_actor_after_enqueue_replay(prompt_dispatch, polling_actor):
    repository, node, context = prompt_dispatch
    token = identity.fg_context.set({"workspace": "company-project", "actor": "accepted-actor"})
    try:
        dispatch = repository.ensure_for_node(node, context=context.model_dump(mode="json"))
    finally:
        identity.fg_context.reset(token)
    polling = {"workspace": "company-project"}
    if polling_actor:
        polling["actor"] = polling_actor
    observed = []
    token = identity.fg_context.set(polling)
    try:
        # Replaying enqueue while another collaborator polls cannot replace attribution.
        assert repository.enqueue(dispatch).dispatch_id == dispatch.dispatch_id
        worker = AgentCanvasPromptPreparationWorker(
            repository, worker_id="recovered-worker",
            prepare=lambda *_: observed.append(("prepare", dict(identity.fg_context.get()))),
            barrier_callback=lambda *_: observed.append(("barrier", dict(identity.fg_context.get()))),
        )
        cycle = worker.run_once()
        assert identity.fg_context.get() == polling
    finally:
        identity.fg_context.reset(token)
    assert cycle.completed == 1
    assert [phase for phase, _ in observed] == ["prepare", "barrier"]
    assert all(value["actor"] == "accepted-actor" for _, value in observed)


def test_legacy_dispatch_without_accepted_actor_cannot_use_polling_actor(prompt_dispatch):
    repository, node, context = prompt_dispatch
    token = identity.fg_context.set({"workspace": "company-project"})
    try:
        repository.ensure_for_node(node, context=context.model_dump(mode="json"))
    finally:
        identity.fg_context.reset(token)
    observed = []

    def prepare(*_):
        observed.append(dict(identity.fg_context.get()))
        identity.headers(None)  # Must fail before a model request can be sent.

    token = identity.fg_context.set({"workspace": "company-project", "actor": "polling-actor"})
    try:
        cycle = AgentCanvasPromptPreparationWorker(
            repository, worker_id="legacy-worker", prepare=prepare,
        ).run_once()
    finally:
        identity.fg_context.reset(token)
    assert cycle.retried == 1
    assert observed == [{"workspace": "company-project"}]
