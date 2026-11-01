"""Hosts both mock targets on one port:
    /pricing/quote, /pricing/schema, /pricing/reveal
    /credit/quote,  /credit/schema,  /credit/reveal
"""

from fastapi import FastAPI

from targets import credit_api, pricing_api

app = FastAPI(title="AUTOPSY mock targets")
app.mount("/pricing", pricing_api.app)
app.mount("/credit", credit_api.app)


@app.get("/")
def index():
    return {"targets": ["pricing", "credit"]}
