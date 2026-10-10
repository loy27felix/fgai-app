from types import SimpleNamespace

import pytest

from app.persistence.errors import V2PersistenceError
from app.schemas.agent_canvas import AgentCanvasWorkflowV2
from app.schemas.agent_canvas_capabilities import CapabilityReferencePlanV1
from app.schemas.agent_canvas_production_journey import (
    GuidedProductionJourneyV2,
    JourneyActionProjectionV2,
)
from app.services.agent_canvas_conversation import AgentConversationService
from app.services.agent_canvas_capability_policy import CapabilityPolicyService
from app.services.agent_canvas_command_compiler import AgentCommandPlanCompiler
from app.services.agent_canvas_production_journey import GuidedProductionJourneyPolicyService


@pytest.fixture
def targeted_service():
    original = JourneyActionProjectionV2(
        action_id="guided-product", action_kind="invoke_capability",
        stage="product", stage_revision=4, status="working", turn_id="guided-turn",
    )
    session = SimpleNamespace(
        revision=7,
        journey=GuidedProductionJourneyV2(
            stage="product", stage_revision=4, active_action=original,
        ),
    )
    transitions = []
    completed = []
    policy = GuidedProductionJourneyPolicyService()

    def apply_evidence(workflow_id, *, evidence, expected_session_revision, idempotency_key):
        assert workflow_id == "workflow"
        assert expected_session_revision == session.revision
        session.journey = policy.apply_evidence(session.journey, evidence)
        session.revision += 1
        transitions.append(evidence.evidence_kind)
        return session

    def complete(turn_id, workflow_id, message):
        assert session.journey.active_action == original
        assert session.journey.suspended_action is None
        completed.append(message)
        return "completed"

    service = AgentConversationService.__new__(AgentConversationService)
    service._conversations = SimpleNamespace(get_guidance_session=lambda workflow_id: session)
    service._journey = SimpleNamespace(apply_evidence=apply_evidence)
    service._capability_policy = SimpleNamespace(
        definition=lambda capability: SimpleNamespace(node_type="image", creative_role="product"),
    )
    service._complete_turn = complete
    args = dict(
        turn=SimpleNamespace(turn_id="target-turn", workflow_id="workflow", conversation_id="chat"),
        capability_id="product_design", objective="Refine the bottle draft only",
        reference_plan=None, context_snapshot_id="snapshot",
        context_snapshot_digest="digest", source_action=None,
    )
    return service, session, original, transitions, completed, args


def test_targeted_draft_restores_guided_action_before_publishing_success(targeted_service):
    service, session, original, transitions, completed, args = targeted_service

    def author(**kwargs):
        assert session.journey.active_action.action_id == "target-turn"
        assert session.journey.suspended_action == original
        return "Draft created"

    service._apply_targeted_authoring_command = author
    assert service._run_targeted_authoring_command(**args) == "completed"
    assert transitions == ["targeted_action_started", "targeted_action_finished"]
    assert session.journey.stage == "product" and session.journey.stage_revision == 4
    assert completed == ["Draft created"]


def test_targeted_draft_compiles_actual_command_before_restoring_journey(targeted_service):
    service, session, original, transitions, completed, args = targeted_service
    plans = []
    service._capability_policy = CapabilityPolicyService()
    service._command_compiler = AgentCommandPlanCompiler()
    service._workflows = SimpleNamespace(get_workflow=lambda workflow_id: AgentCanvasWorkflowV2(
        workflow_id="workflow", project_id="project", revision=1,
    ))

    def submit(*, plan, idempotency_key):
        assert session.journey.active_action.action_id == "target-turn"
        plans.append(plan)
        return SimpleNamespace(receipt=SimpleNamespace(receipt_id="receipt"))

    service._command_service = SimpleNamespace(submit=submit)
    args["reference_plan"] = CapabilityReferencePlanV1(
        capability_id="product_design", digest="a" * 64,
    )
    assert service._run_targeted_authoring_command(**args) == "completed"
    assert len(plans) == 1 and len(plans[0].operations) == 1
    draft = plans[0].operations[0]
    assert draft.operation_type == "create_draft_node"
    assert draft.creative_role == "product" and draft.node_type == "image"
    assert draft.generation_prompt == args["objective"]
    assert plans[0].risk == "reversible_authoring" and not plans[0].confirmation_required
    assert transitions == ["targeted_action_started", "targeted_action_finished"]


@pytest.mark.parametrize("error", [
    RuntimeError("provider failed"),
    V2PersistenceError("command_conflict", "Draft revision changed", stage="test"),
])
def test_failed_targeted_draft_resumes_original_without_false_completion(
    targeted_service, error,
):
    service, session, original, transitions, completed, args = targeted_service

    def fail(**kwargs):
        assert session.journey.suspended_action == original
        raise error

    service._apply_targeted_authoring_command = fail
    with pytest.raises(type(error)) as caught:
        service._run_targeted_authoring_command(**args)
    assert caught.value is error
    assert session.journey.active_action == original
    assert session.journey.suspended_action is None
    assert transitions == ["targeted_action_started", "targeted_action_finished"]
    assert completed == []


def test_unsupported_target_does_not_suspend_existing_journey(targeted_service):
    service, session, original, transitions, completed, args = targeted_service
    service._capability_policy.definition = lambda capability: SimpleNamespace(
        node_type=None, creative_role=None,
    )
    with pytest.raises(V2PersistenceError) as caught:
        service._run_targeted_authoring_command(**args)
    assert caught.value.code == "targeted_authoring_not_supported"
    assert session.journey.active_action == original
    assert session.journey.suspended_action is None
    assert transitions == [] and completed == []


def test_concurrent_target_cannot_restore_another_turn_authority(targeted_service):
    service, session, original, transitions, completed, args = targeted_service

    def changed_authority(**kwargs):
        session.journey = session.journey.model_copy(update={
            "active_action": session.journey.active_action.model_copy(update={
                "action_id": "another-target",
            }),
        })
        return "Draft created"

    service._apply_targeted_authoring_command = changed_authority
    with pytest.raises(V2PersistenceError) as caught:
        service._run_targeted_authoring_command(**args)
    assert caught.value.code == "targeted_authoring_authority_missing"
    assert session.journey.active_action.action_id == "another-target"
    assert session.journey.suspended_action == original
    assert transitions == ["targeted_action_started"] and completed == []


@pytest.mark.parametrize("prior_status", ["failed", "running"])
def test_prior_failed_target_can_resume_but_running_target_keeps_ownership(
    targeted_service, prior_status,
):
    service, session, original, transitions, completed, args = targeted_service
    prior = JourneyActionProjectionV2(
        action_id="prior-target", action_kind="targeted_authoring", stage="product",
        stage_revision=4, status="working",
    )
    session.journey = session.journey.model_copy(update={
        "active_action": prior, "suspended_action": original,
    })
    service._conversations.get_turn = lambda turn_id: SimpleNamespace(
        workflow_id="workflow", status=prior_status,
    )
    service._apply_targeted_authoring_command = lambda **kwargs: "Draft created"
    if prior_status == "failed":
        assert service._run_targeted_authoring_command(**args) == "completed"
        assert session.journey.active_action == original
        assert session.journey.suspended_action is None
        assert transitions == [
            "targeted_action_finished", "targeted_action_started", "targeted_action_finished",
        ]
    else:
        with pytest.raises(V2PersistenceError) as caught:
            service._run_targeted_authoring_command(**args)
        assert caught.value.code == "journey_action_in_progress"
        assert session.journey.active_action == prior
        assert session.journey.suspended_action == original
        assert transitions == [] and completed == []
