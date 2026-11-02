"""Uploaded image mentions must survive duration selection and text authoring."""
from types import SimpleNamespace

import pytest

from app.persistence.errors import V2PersistenceError
from app.services.agent_canvas_capability_reference_planner import CapabilityReferencePlanner
from app.services.agent_canvas_connection_policy import AgentCanvasConnectionPolicyService
from app.services.agent_canvas_guided_duration import GuidedDurationAuthorityPolicy
from app.schemas.agent_canvas_guided_interactions import GuidedQuestionnaireSubmitV1


def reference_inputs():
    nodes = tuple(SimpleNamespace(node_id=f'image-{i}', node_type='image',
        creative_role='general_image', title=f'Product view {i}', metadata={}) for i in range(6))
    workflow = SimpleNamespace(workflow_id='workflow', project_id='project', nodes=nodes)
    session = SimpleNamespace(topics=(), element_decisions=(),
        journey=SimpleNamespace(policy_version='fixed_ad_production_v2'))
    return workflow, session


@pytest.mark.parametrize('capability', ['world_setting', 'script_authoring'])
def test_six_uploaded_images_remain_authoring_context(capability):
    workflow, session = reference_inputs()
    class MediaSelectionMustNotLimitAuthoring:
        def validate_selection(self, **kwargs):
            raise AssertionError('Text authoring references are not media generation inputs')
    planner = CapabilityReferencePlanner(model_selection=MediaSelectionMustNotLimitAuthoring())
    plan = planner.plan(workflow=workflow, session=session, capability_id=capability,
        objective='Create a 45-second advertisement',
        explicit_node_ids=tuple(n.node_id for n in workflow.nodes))
    assert len(plan.references) == 6
    assert tuple(r.source_id for r in plan.references) == tuple(n.node_id for n in workflow.nodes)
    assert all(r.input_role == 'image_reference' for r in plan.references)
    assert not plan.warnings
    # No relaxation of Canvas graph connection types.
    assert not AgentCanvasConnectionPolicyService().decide(source_node_type='image',
        target_node_type='text', input_role='image_reference').accepted


def test_image_asset_context_keeps_project_membership_validation():
    workflow, session = reference_inputs()
    asset = SimpleNamespace(asset_id='asset', project_id='project', workflow_id='workflow',
        media_type='image', display_name='Product', source_semantic_role=None)
    planner = CapabilityReferencePlanner()
    plan = planner.plan(workflow=workflow, session=session, capability_id='world_setting',
        objective='Create ad', explicit_image_asset_ids=('asset',), asset_resolver=lambda _: asset)
    assert plan.references[0].source_id == 'asset'
    asset.project_id, asset.workflow_id = 'other-project', 'other-workflow'
    with pytest.raises(V2PersistenceError, match='current project'):
        planner.plan(workflow=workflow, session=session, capability_id='world_setting',
            objective='Create ad', explicit_image_asset_ids=('asset',), asset_resolver=lambda _: asset)


def test_incompatible_audio_authoring_and_missing_nodes_still_rejected():
    workflow, session = reference_inputs()
    planner = CapabilityReferencePlanner()
    with pytest.raises(V2PersistenceError, match='incompatible'):
        planner.plan(workflow=workflow, session=session, capability_id='bgm_direction',
            objective='Create music', explicit_node_ids=('image-0',))
    with pytest.raises(V2PersistenceError, match='current workflow'):
        planner.plan(workflow=workflow, session=session, capability_id='world_setting',
            objective='Create ad', explicit_node_ids=('missing',))


def test_duration_question_uses_chinese_locale_without_changing_option_identity():
    policy = GuidedDurationAuthorityPolicy()
    # The duration lookup is independent of locale.
    policy.duration_or_none = lambda _: None
    question = policy.questionnaire(SimpleNamespace(), response_locale='zh-CN').questions[0]
    assert question.prompt == '请选择广告总时长。'
    assert [(o.option_id, o.title) for o in question.options][2] == ('duration_seconds_45', '45 秒')
    assert policy.questionnaire(SimpleNamespace(), response_locale='en-US').questions[0].options[2].title == '45 seconds'
    questionnaire = policy.questionnaire(SimpleNamespace(), response_locale='zh-CN')
    selected = policy.resolve_answer(questionnaire, GuidedQuestionnaireSubmitV1(
        submission_kind='questionnaire', expected_interaction_revision=1,
        expected_session_revision=1, answers=({'answer_kind':'option',
            'question_id':'production_duration_seconds','option_id':'duration_seconds_45'},)))
    assert selected.effect.value == 45


def test_failure_message_is_localized_and_does_not_expose_internal_payload(monkeypatch):
    import app.persistence.agent_canvas_conversation_repository as repository
    from app.schemas.agent_canvas_errors import ActionableFailureV1
    captured = []
    monkeypatch.setattr(repository, '_guidance_response_locale', lambda *_: 'zh-CN')
    monkeypatch.setattr(repository, '_publish_assistant_message_in_transaction',
        lambda *args, **kwargs: captured.append(kwargs))
    connection = SimpleNamespace(execute=lambda _: SimpleNamespace(first=lambda: None))
    repository.publish_next_action_failure_in_transaction(connection, events=None,
        turn={'turn_kind':'next_action','turn_id':'turn','workflow_id':'workflow'},
        code='capability_reference_plan_invalid', retryable=True,
        actionable_failure=ActionableFailureV1(failure_class='transient',
            retry_scope='turn',user_action='retry'), now='2026-10-27T01:23:00Z')
    assert '参考素材' in captured[0]['assistant_message']
    assert '重试' in captured[0]['assistant_message']
    assert captured[0]['metadata']['error_code'] == 'capability_reference_plan_invalid'


def test_targeted_document_keeps_image_context_without_invalid_graph_bindings():
    from app.services.agent_canvas_conversation import AgentConversationService
    from app.services.agent_canvas_capability_policy import CapabilityPolicyService
    workflow, session = reference_inputs()
    plan = CapabilityReferencePlanner().plan(workflow=workflow, session=session,
        capability_id='world_setting',objective='Create ad',
        explicit_node_ids=tuple(n.node_id for n in workflow.nodes))
    captured = []
    service = object.__new__(AgentConversationService)
    service._capability_policy = CapabilityPolicyService()
    service._workflows = SimpleNamespace(get_workflow=lambda _:workflow)
    service._command_compiler = SimpleNamespace(compile=lambda **kw:captured.append(kw))
    service._command_service = SimpleNamespace(submit=lambda **kw:SimpleNamespace(receipt=object()))
    service._apply_targeted_authoring_command(turn=SimpleNamespace(turn_id='turn',workflow_id='workflow'),
        capability_id='world_setting',objective='Create ad',reference_plan=plan,
        context_snapshot_id='context',context_snapshot_digest='a'*64,source_action=None)
    assert len(captured[0]['resolved_mentions'].explicit_node_ids) == 6
    assert [op.operation_type for op in captured[0]['envelope'].command_plan.operations] == ['create_draft_node']


def test_document_materialization_does_not_turn_visual_context_into_a_graph_edge():
    from datetime import datetime, timezone
    from app.services.agent_canvas_capability_draft_bundle import _draft_nodes
    from app.schemas.agent_canvas_creative_session import DraftReferenceIntentV2
    envelope = SimpleNamespace(materialization_id='mat',operation_kind='direct',
        capability_id='world_setting',workflow_id='workflow',context_snapshot_id='context',
        created_at=datetime.now(timezone.utc))
    draft = SimpleNamespace(node_type='text',creative_role='world_setting',title='World',
        summary_prompt='World',structured_content={'content':'World'},parameters={},
        prompt_context_snapshot_id=None,parameter_provenance={},reference_intents=(
            DraftReferenceIntentV2(source_kind='node',source_id='image-0',
                binding_kind='image_reference',input_role='image_reference',display_order=0),))
    nodes,bindings,_ = _draft_nodes(envelope,(draft,),('document',))
    assert len(nodes) == 1 and not bindings
