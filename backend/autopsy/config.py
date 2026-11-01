"""Runtime configuration, all from environment variables."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def env(name: str, default: str) -> str:
    return os.environ.get(name, default)


# where the black-box targets are served (HTTP only; agents never import target code)
TARGETS_URL = env("AUTOPSY_TARGETS_URL", "http://127.0.0.1:8100")
TARGET_IDS = [t.strip() for t in env("AUTOPSY_TARGETS", "pricing,credit").split(",") if t.strip()]

# LLM for the Persona and Reporter agents (Ollama by default). AUTOPSY_LLM=off uses templates.
LLM_PROVIDER = env("AUTOPSY_LLM", "ollama")  # ollama | openai | off
LLM_MODEL = env("AUTOPSY_LLM_MODEL", "qwen2.5:3b")
LLM_URL = env("AUTOPSY_LLM_URL", "http://127.0.0.1:11434")
LLM_API_KEY = env("AUTOPSY_LLM_API_KEY", "")
LLM_TIMEOUT = float(env("AUTOPSY_LLM_TIMEOUT", "60"))

# shared agent memory: sqlite (default) or meko
MEMORY_BACKEND = env("AUTOPSY_MEMORY", "sqlite")
MEKO_URL = env("AUTOPSY_MEKO_URL", "")
MEKO_TOKEN = env("AUTOPSY_MEKO_TOKEN", "")

DATA_DIR = Path(env("AUTOPSY_DATA_DIR", str(ROOT / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
