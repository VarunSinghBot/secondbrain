from fastapi.testclient import TestClient

from app.main import app


def test_health_is_open_and_identifies_service() -> None:
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "service": "rag-service"}
