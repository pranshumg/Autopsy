import socket
import threading
import time

import pytest
import uvicorn


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="session")
def targets_url():
    """Serve the mock targets over real HTTP for the whole test session."""
    from autopsy import config

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config("targets.server:app", host="127.0.0.1", port=port, log_level="error"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    url = f"http://127.0.0.1:{port}"
    config.TARGETS_URL = url
    yield url
    server.should_exit = True
