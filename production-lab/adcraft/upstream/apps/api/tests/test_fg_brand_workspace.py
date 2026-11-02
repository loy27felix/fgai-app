"""Brand entry uses the same project store while retaining the user's mode."""
from dataclasses import replace
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app


def test_brand_creation_opens_a_real_decision_panel_in_an_isolated_workspace(tmp_path):
    settings=replace(Settings(),media_data_dir=tmp_path/'brand',media_mode='mock',agent_runtime_mode='fake')
    with TestClient(create_app(settings)) as client:
        created=client.post('/api/v2/projects',json={'name':'Brand fixture','description':'Product launch fixture','mode':'brand'},headers={'Idempotency-Key':'brand-fixture'})
        assert created.status_code==201,created.text
        project=created.json()
        detail=client.get('/api/v2/projects/'+project['project_id'])
        assert detail.status_code==200
        assert detail.json()['mode']=='brand'
        panel=client.get('/api/v2/brand/decisions',params={'workflow_id':project['workflow_id']})
        assert panel.status_code==200,panel.text
        assert panel.json()['workflow_id']==project['workflow_id']


def test_two_application_workspaces_do_not_share_brand_decisions(tmp_path):
    first=replace(Settings(),media_data_dir=tmp_path/'first',media_mode='mock',agent_runtime_mode='fake')
    second=replace(first,media_data_dir=tmp_path/'second')
    with TestClient(create_app(first)) as a, TestClient(create_app(second)) as b:
        project=a.post('/api/v2/projects',json={'name':'Private brand','mode':'brand'},headers={'Idempotency-Key':'first-brand'}).json()
        b.post('/api/v2/projects',json={'name':'Other brand','mode':'brand'},headers={'Idempotency-Key':'second-brand'})
        url='/api/v2/brand/decisions';params={'workflow_id':project['workflow_id']}
        assert a.get(url,params=params).status_code==200
        assert b.get(url,params=params).status_code==404
        assert a.get(url,params=params).status_code==200
