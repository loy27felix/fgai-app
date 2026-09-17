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
    monkeypatch.setattr(capabilities, "_nvidia_device", lambda: (None, 0))
    capability = capabilities.detect_capabilities()
    assert capability["backends"] == ["cpu"]
    assert capability["operations"] == []


def test_gpu_only_advertises_configured_model_runners(monkeypatch):
    import fg_worker.capabilities as capabilities

    class FakeCuda:
        @staticmethod
        def is_available():
            return True

        @staticmethod
        def get_device_name(_index):
            return "Test CUDA"

        @staticmethod
        def mem_get_info(_index):
            return (1, 8 * 1024 * 1024 * 1024)

    class FakeBackends:
        mps = None

    class FakeTorch:
        cuda = FakeCuda()
        backends = FakeBackends()

    monkeypatch.setattr(capabilities, "_torch_module", lambda: FakeTorch())
    monkeypatch.delenv("FG_WORKER_BASICVSRPP_COMMAND", raising=False)
    monkeypatch.delenv("FG_WORKER_REALESRGAN_COMMAND", raising=False)
    monkeypatch.delenv("FG_WORKER_PROPAINTER_COMMAND", raising=False)
    assert capabilities.detect_capabilities()["operations"] == []

    monkeypatch.setenv("FG_WORKER_BASICVSRPP_COMMAND", "basicvsrpp-runner")
    monkeypatch.setattr(capabilities, "runner_available", lambda profile: profile == "basicvsrpp-quality")
    capability = capabilities.detect_capabilities()
    assert capability["operations"] == ["video_super_resolution"]
    assert capability["modelProfiles"] == ["basicvsrpp-quality"]
