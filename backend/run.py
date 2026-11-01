"""One command to start everything:
    uv run python run.py            targets on :8100, engine API on :8000

Then start the web UI from the repo root with `npm run dev` and open http://localhost:3000.
"""

import argparse
import multiprocessing
import time

import uvicorn


def serve(app: str, port: int):
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets-port", type=int, default=8100)
    ap.add_argument("--engine-port", type=int, default=8000)
    a = ap.parse_args()
    procs = [
        multiprocessing.Process(target=serve, args=("targets.server:app", a.targets_port), daemon=True),
        multiprocessing.Process(target=serve, args=("autopsy.api:app", a.engine_port), daemon=True),
    ]
    for p in procs:
        p.start()
    print(f"AUTOPSY targets  → http://127.0.0.1:{a.targets_port}  (/pricing/quote, /credit/quote)")
    print(f"AUTOPSY engine   → http://127.0.0.1:{a.engine_port}   (/health)")
    print("Web UI           → run `npm run dev` in the repo root, then open http://localhost:3000/lab")
    try:
        while all(p.is_alive() for p in procs):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
