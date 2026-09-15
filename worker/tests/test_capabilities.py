def test_cpu_capability_never_advertises_gpu(monkeypatch):
    import fg_worker.capabilities as capabilities

    class FakeCuda:
        @staticmethod
        def is_available():
            return False

    class FakeMps:
        @staticmethod
        def is_available():
            return False

    class FakeBackends:
        mps = FakeMps()

    class FakeTorch:
        cuda = FakeCuda()
        backends = FakeBackends()

    monkeypatch.setattr(capabilities, "_torch_module", lambda: FakeTorch())
    capability = capabilities.detect_capabilities()
    assert capability["backends"] == ["cpu"]
    assert capability["operations"] == []

