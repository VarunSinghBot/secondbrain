from fastapi import FastAPI

app = FastAPI(title="rag-service")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "rag-service"}
