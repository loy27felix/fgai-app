"""Service availability failures can be explicitly retried without resetting workflow state."""
from datetime import datetime, timezone

import pytest

from app.persistence.agent_canvas_conversation_repository import _turn
from app.schemas.agent_canvas_conversation import ContinuationDeliveryV2
from app.services.agent_canvas_explicit_retry import explicit_turn_retryable


def failure_row(code='agent_runtime_unavailable'):
    now = datetime.now(timezone.utc).isoformat()
    return dict(
        turn_id='failed-turn', workflow_id='workflow', conversation_id='chat', status='failed',
        turn_kind='capability', request_json='{}', creation_mode_json=None,
        guidance_session_revision=10, retry_of_turn_id=None, retry_attempt_no=1,
        retryable=False, operation_stage=None, operation_failure_json=None,
        error_code=code, error_message='Agent runtime is unavailable.', created_at=now, updated_at=now,
    )


def delivery(operation='capability_command'):
    now = datetime.now(timezone.utc)
    return ContinuationDeliveryV2(
        continuation_id='continuation', workflow_id='workflow', conversation_id='chat',
        source_turn_id='source', continuation_turn_id='failed-turn', operation=operation,
        envelope_id='envelope', payload_digest='a' * 64, status='failed', attempt_count=1,
        max_attempts=5, lease_generation=1, next_attempt_at=now, created_at=now, updated_at=now,
    )


def test_runtime_unavailable_is_eligible_for_explicit_manual_retry():
    assert explicit_turn_retryable('agent_runtime_unavailable')


@pytest.mark.parametrize('operation', ['next_action', 'capability_command'])
def test_old_typed_service_failure_exposes_retry_without_rewriting_audit(operation):
    row = failure_row()
    turn = _turn(row, continuation=delivery(operation))
    assert turn.retryable
    assert turn.actionable_failure.retry_scope == 'turn'
    assert turn.actionable_failure.user_action == 'retry'
    assert row['retryable'] is False and row['status'] == 'failed'


@pytest.mark.parametrize('code', ['invalid_reference', 'permission_denied', 'fg_actor_missing'])
def test_deterministic_failures_remain_blocked(code):
    assert not _turn(failure_row(code), continuation=delivery()).retryable


def test_untyped_legacy_failure_still_requires_its_own_recovery_authority():
    assert not _turn(failure_row()).retryable


def test_repaired_image_context_failure_exposes_only_manual_typed_retry():
    row = failure_row('capability_reference_plan_invalid')
    row['error_message'] = 'Mentioned Node is incompatible with the target capability.'
    assert explicit_turn_retryable(row['error_code'], row['error_message'])
    assert _turn(row, continuation=delivery('next_action')).retryable
    assert row['retryable'] is False
    assert not _turn(row).retryable
    row['error_message'] = 'Mentioned image asset does not belong to the current project.'
    assert not explicit_turn_retryable(row['error_code'], row['error_message'])
    assert not _turn(row, continuation=delivery('next_action')).retryable
