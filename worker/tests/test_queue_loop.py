from fg_worker.queue_loop import WorkerLoop


def test_loop_does_not_claim_when_token_is_missing():
    assert WorkerLoop.can_start(token=None) is False
    assert WorkerLoop.can_start(token="short") is False
    assert WorkerLoop.can_start(token="fgw_" + "x" * 32) is True

