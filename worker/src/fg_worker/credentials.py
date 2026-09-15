from __future__ import annotations


SERVICE_NAME = "fg-studio-worker"
ACCOUNT_NAME = "worker-token"


class CredentialStoreUnavailable(RuntimeError):
    pass


def _keyring():
    try:
        import keyring  # type: ignore

        return keyring
    except Exception as error:  # pragma: no cover - depends on host packaging
        raise CredentialStoreUnavailable("系统钥匙串不可用，拒绝以明文保存 Worker 令牌") from error


def save_token(token: str) -> None:
    if not isinstance(token, str) or not token:
        raise ValueError("Worker token is empty")
    keyring = _keyring()
    try:
        keyring.set_password(SERVICE_NAME, ACCOUNT_NAME, token)
    except Exception as error:
        raise CredentialStoreUnavailable("系统钥匙串不可写，拒绝保存 Worker 令牌") from error


def load_token() -> str | None:
    keyring = _keyring()
    try:
        return keyring.get_password(SERVICE_NAME, ACCOUNT_NAME)
    except Exception as error:
        raise CredentialStoreUnavailable("系统钥匙串不可读") from error


def clear_token() -> None:
    keyring = _keyring()
    try:
        keyring.delete_password(SERVICE_NAME, ACCOUNT_NAME)
    except Exception:
        # Deleting an already-empty keyring entry is idempotent.
        pass

