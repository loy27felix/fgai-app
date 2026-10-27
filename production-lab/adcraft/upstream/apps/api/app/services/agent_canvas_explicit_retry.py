"""Closed manual retry policy for typed Agent Canvas operations."""

from __future__ import annotations


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
