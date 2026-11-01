"""LLM client for the Persona and Reporter agents.

Default: a local model through Ollama (free, offline). Also supports any
OpenAI-compatible endpoint. Every call has a deterministic fallback, so the
system runs (and stays reproducible) with AUTOPSY_LLM=off or no model available.
The LLM never does statistics; it only writes personas and plain-language text.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from autopsy import config


class LLM:
    def __init__(self):
        self.provider = config.LLM_PROVIDER
        self.model = config.LLM_MODEL
        self.available: bool | None = None
        self.calls = 0
        self.failures = 0

    @property
    def label(self) -> str:
        return "templates (LLM off)" if self.provider == "off" else f"{self.provider}:{self.model}"

    def check(self) -> bool:
        if self.provider == "off":
            self.available = False
        elif self.available is None:
            try:
                if self.provider == "ollama":
                    tags = httpx.get(f"{config.LLM_URL}/api/tags", timeout=3).json()
                    names = {m["name"] for m in tags.get("models", [])}
                    self.available = self.model in names or f"{self.model}:latest" in names
                else:
                    self.available = True
            except Exception:  # noqa: BLE001
                self.available = False
        return bool(self.available)

    def chat(self, system: str, user: str, json_mode: bool = False, temperature: float = 0.4, seed: int | None = None) -> str | None:
        if not self.check():
            return None
        self.calls += 1
        try:
            if self.provider == "ollama":
                body: dict[str, Any] = {
                    "model": self.model,
                    "stream": False,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                    "options": {"temperature": temperature, **({"seed": seed} if seed is not None else {})},
                }
                if json_mode:
                    body["format"] = "json"
                r = httpx.post(f"{config.LLM_URL}/api/chat", json=body, timeout=config.LLM_TIMEOUT)
                r.raise_for_status()
                return r.json()["message"]["content"]
            headers = {"authorization": f"Bearer {config.LLM_API_KEY}"} if config.LLM_API_KEY else {}
            body = {
                "model": self.model,
                "temperature": temperature,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                **({"response_format": {"type": "json_object"}} if json_mode else {}),
                **({"seed": seed} if seed is not None else {}),
            }
            r = httpx.post(f"{config.LLM_URL.rstrip('/')}/chat/completions", json=body, headers=headers, timeout=config.LLM_TIMEOUT)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
        except Exception:  # noqa: BLE001 - fall back to templates
            self.failures += 1
            return None

    def json(self, system: str, user: str, seed: int | None = None) -> Any:
        text = self.chat(system, user, json_mode=True, seed=seed)
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}|\[.*\]", text, re.S)
            try:
                return json.loads(m.group(0)) if m else None
            except json.JSONDecodeError:
                return None
