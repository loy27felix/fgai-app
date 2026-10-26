"""Capability retries must publish their own expert activity atomically."""
from datetime import datetime, timezone
import json

import pytest
from sqlalchemy import insert, select, func

import app.persistence.agent_canvas_conversation_repository as conversations
from app.persistence.database import create_v2_database
from app.persistence.event_repository import EventRepository
from app.persistence.models import (
    ProjectRow, AgentCanvasWorkflowRow, AgentCanvasConversationRow,
    AgentCanvasChatTurnRow, AgentCanvasExpertActivityRow, AgentCanvasChatEntryRow,
    AgentCanvasContinuationOutboxRow, AgentCanvasOperationEnvelopeRow,
)
from app.schemas.agent_canvas_guidance import ContinuationTurnRetrySnapshotV1
from tests.test_fg_retry_envelope_digest import envelope


@pytest.fixture
def retry_repository(v2_media_data_dir):
    database = create_v2_database(v2_media_data_dir)
    stamp = datetime.now(timezone.utc).isoformat()
    with database.engine.begin() as connection:
        connection.execute(insert(ProjectRow).values(project_id='project', name='Cup', created_at=stamp, updated_at=stamp))
        connection.execute(insert(AgentCanvasWorkflowRow).values(workflow_id='workflow', project_id='project', created_at=stamp, updated_at=stamp))
        connection.execute(insert(AgentCanvasConversationRow).values(conversation_id='chat', workflow_id='workflow', created_at=stamp, updated_at=stamp))
        connection.execute(insert(AgentCanvasChatTurnRow).values(
            turn_id='failed-turn', conversation_id='chat', workflow_id='workflow', turn_kind='capability',
            status='failed', retryable=True, request_json='{}', idempotency_key='original', created_at=stamp, updated_at=stamp))
        connection.execute(insert(AgentCanvasExpertActivityRow).values(
            activity_id='original-activity',turn_id='failed-turn',workflow_id='workflow',
            capability_id='product_design',operation='propose_product_options',status='failed',
            display_name='Product Designer',created_at=stamp,updated_at=stamp))
    repository = conversations.AgentCanvasConversationRepository(database, EventRepository(database))
    source = repository.get_turn('failed-turn')
    snapshot = ContinuationTurnRetrySnapshotV1(
        workflow_id='workflow', conversation_id='chat', session_id='session', workflow_revision=1,
        session_revision=1, journey_stage='product', journey_stage_revision=1, logical_action_id='action',
        root_turn_id='source', operation='capability_command', envelope_id='envelope', envelope_digest='a' * 64,
        requirement_revision_id='requirement', requirement_digest='b' * 64, node_revisions={}, asset_ids=(),
        response_locale='und', policy_identity_digest='c' * 64,
    )
    def retry(key='retry-once'):
        return repository.create_typed_retry_turn(source, source_envelope=envelope(),
            operation='capability_command', idempotency_key=key, retry_snapshot=snapshot)
    try:
        yield repository, database, retry
    finally:
        database.dispose()


def test_capability_retry_can_publish_completed_activity(retry_repository):
    repository, database, retry = retry_repository
    accepted = retry()
    with database.engine.connect() as connection:
        row = connection.execute(select(AgentCanvasExpertActivityRow).where(
            AgentCanvasExpertActivityRow.turn_id == accepted.turn_id)).mappings().one()
    assert row['status'] == 'working'
    assert row['capability_id'] == 'product_design'
    assert row['operation'] == 'propose_product_options'
    completed = repository.transition_expert_activity(row['activity_id'], status='completed')
    assert completed.status == 'completed'
    assert completed.turn_id == accepted.turn_id


def test_retry_replay_does_not_duplicate_expert_activity_or_timeline(retry_repository):
    repository, database, retry = retry_repository
    accepted = retry()
    replay = retry()
    assert replay.replayed and replay.turn_id == accepted.turn_id
    with database.engine.connect() as connection:
        assert connection.execute(select(func.count()).select_from(AgentCanvasExpertActivityRow).where(AgentCanvasExpertActivityRow.turn_id == accepted.turn_id)).scalar_one() == 1
        assert connection.execute(select(func.count()).select_from(AgentCanvasChatEntryRow).where(
            AgentCanvasChatEntryRow.entry_type == 'expert_activity')).scalar_one() == 1


def test_activity_write_failure_rolls_back_retry_envelope_and_queue(retry_repository, monkeypatch):
    repository, database, retry = retry_repository
    def fail(*args, **kwargs):
        raise RuntimeError('Simulated timeline storage failure')
    monkeypatch.setattr(conversations, '_append_timeline_entry', fail)
    with pytest.raises(RuntimeError, match='timeline storage'):
        retry()
    with database.engine.connect() as connection:
        assert connection.execute(select(func.count()).select_from(AgentCanvasChatTurnRow)).scalar_one() == 1
        for model in (AgentCanvasExpertActivityRow, AgentCanvasContinuationOutboxRow, AgentCanvasOperationEnvelopeRow):
            assert connection.execute(select(func.count()).select_from(model)).scalar_one() == (1 if model is AgentCanvasExpertActivityRow else 0)


def test_failed_retry_publishes_a_new_terminal_timeline_revision(retry_repository):
    repository, database, retry = retry_repository
    accepted = retry()
    with database.engine.connect() as connection:
        started = connection.execute(select(AgentCanvasChatEntryRow).where(
            AgentCanvasChatEntryRow.entry_type == 'expert_activity')).mappings().one()
    repository.fail_turn(accepted.turn_id, code='agent_provider_transport_failed',
        message='Agent provider transport failed.', retryable=True, response_locale='zh-CN')
    with database.engine.connect() as connection:
        entries = connection.execute(select(AgentCanvasChatEntryRow).where(
            AgentCanvasChatEntryRow.entry_type == 'expert_activity').order_by(
                AgentCanvasChatEntryRow.sequence_no)).mappings().all()
        activity = connection.execute(select(AgentCanvasExpertActivityRow).where(AgentCanvasExpertActivityRow.turn_id == accepted.turn_id)).mappings().one()
    assert len(entries) == 2
    assert entries[-1]['sequence_no'] > started['sequence_no']
    metadata = json.loads(entries[-1]['metadata_json'])
    assert metadata['message_key'] == 'expert_activity.failed'
    assert metadata['response_locale'] == 'zh-CN'
    assert metadata['presentation_key'] == json.loads(started['metadata_json'])['presentation_key']
    assert metadata['error_code'] == 'agent_provider_transport_failed'
    assert activity['status'] == 'failed'
    # Repeated failure delivery must not publish a second terminal card.
    repository.fail_turn(accepted.turn_id, code='agent_provider_transport_failed',
        message='Agent provider transport failed.', retryable=True, response_locale='zh-CN')
    with database.engine.connect() as connection:
        assert connection.execute(select(func.count()).select_from(AgentCanvasChatEntryRow).where(
            AgentCanvasChatEntryRow.entry_type == 'expert_activity')).scalar_one() == 2


def test_failed_retry_publication_is_atomic(retry_repository, monkeypatch):
    repository, database, retry = retry_repository
    accepted = retry()
    def fail(*args, **kwargs):
        raise RuntimeError('Simulated terminal publication failure')
    monkeypatch.setattr(conversations, 'publish_expert_activity_terminal_in_transaction', fail)
    with pytest.raises(RuntimeError, match='terminal publication'):
        repository.fail_turn(accepted.turn_id, code='agent_provider_transport_failed',
            message='Agent provider transport failed.', retryable=True)
    assert repository.get_turn(accepted.turn_id).status != 'failed'
    with database.engine.connect() as connection:
        assert connection.execute(select(AgentCanvasExpertActivityRow.status).where(AgentCanvasExpertActivityRow.turn_id == accepted.turn_id)).scalar_one() == 'working'
