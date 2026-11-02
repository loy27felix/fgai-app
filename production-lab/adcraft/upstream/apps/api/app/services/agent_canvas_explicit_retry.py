"""Closed manual retry policy for typed Agent Canvas operations."""

from __future__ import annotations
from datetime import datetime


_EXPLICIT_RETRYABLE_ERRORS = frozenset(
    {
        "agent_provider_timeout",
        "agent_provider_transport_failed",
        "agent_structured_output_invalid",
        "agent_runtime_unavailable",
    }
)


def repaired_reference_retryable(error_code: str, error_message: str | None) -> bool:
    """Expose a manual attempt for the former image/text authoring mismatch.

    Ownership, missing-source and scope errors with this shared code stay blocked.
    Frozen envelope/revision validation still runs before a retry is admitted.
    """
    return error_code == "capability_reference_plan_invalid" and error_message in {
        "Mentioned Node is incompatible with the target capability.",
        "Mentioned image asset is incompatible with the target capability.",
    }


def explicit_turn_retryable(error_code: str, error_message: str | None = None) -> bool:
    """Return whether a terminal typed operation may receive one fresh attempt."""

    return error_code in _EXPLICIT_RETRYABLE_ERRORS or repaired_reference_retryable(error_code, error_message)


def reconcile_repaired_authoring_reservation(snapshot, source, session):
    """Reconcile only the single reservation made by this failed authoring turn.

    This is an in-memory retry projection, never an edit to the old audit. All
    workflow, requirement, source and envelope checks remain in retry admission.
    """
    if session is None or not repaired_reference_retryable(source.error_code or "", source.error_message):
        return snapshot
    journey = session.journey
    action = journey.active_action
    if (
        source.turn_kind == "next_action"
        and snapshot.operation == "next_action"
        and session.session_id == snapshot.session_id
        and session.revision == snapshot.session_revision + 1
        and journey.stage == snapshot.journey_stage
        and journey.stage_revision == snapshot.journey_stage_revision
        and action is not None
        and action.status == "reserved"
        and action.turn_id == source.turn_id
        and action.action_id == f"journey-action:{source.turn_id}"
        and action.stage == journey.stage
        and action.stage_revision == journey.stage_revision
        and action.action_kind in {"invoke_capability:world_setting", "invoke_capability:script_authoring"}
    ):
        return snapshot.model_copy(update={"session_revision": session.revision, "logical_action_id": action.action_id})
    return snapshot


def trim_preexisting_deleted_retry_nodes(snapshot, rows, turn_created_at):
    """Remove only unchanged tombstones that already existed before this turn."""
    revisions = snapshot.get("node_revisions")
    if not isinstance(revisions, dict):
        return snapshot
    try:
        created = datetime.fromisoformat(str(turn_created_at).replace("Z", "+00:00"))
    except ValueError:
        return snapshot
    excluded = set()
    for row in rows:
        if revisions.get(row["node_id"]) != row["revision"] or not isinstance(row["deleted_at"], str):
            continue
        try:
            deleted = datetime.fromisoformat(row["deleted_at"].replace("Z", "+00:00"))
            if deleted <= created:
                excluded.add(row["node_id"])
        except (ValueError, TypeError):
            continue
    return {**snapshot, "node_revisions": {k:v for k,v in revisions.items() if k not in excluded}}
