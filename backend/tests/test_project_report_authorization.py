from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.core import security
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.tables import InspectionReport, Project, TrialDetectionResult, UserAccount


@compiles(JSONB, "sqlite")
def compile_jsonb_for_sqlite(type_, compiler, **kwargs):
    return "JSON"


PROJECT_ID = "00000000-0000-0000-0000-000000000099"
PROTECTED_GET_PATHS = [
    "/api/projects",
    "/api/reports",
    "/api/reports?include_generated=true",
    f"/api/projects/{PROJECT_ID}",
    f"/api/projects/{PROJECT_ID}/photos",
    f"/api/projects/{PROJECT_ID}/building-model",
    f"/api/projects/{PROJECT_ID}/building-model-images",
    f"/api/projects/{PROJECT_ID}/detection-config",
    f"/api/projects/{PROJECT_ID}/reviewed-result",
    f"/api/reports/{PROJECT_ID}",
    f"/api/reports/{PROJECT_ID}?include_generated=true",
    f"/api/reports/{PROJECT_ID}/pdf",
    f"/api/reports/{PROJECT_ID}/docx",
    "/api/projects/not-a-uuid",
    "/api/reports/not-a-uuid",
]


class NoQueryDb:
    def __getattr__(self, name):
        pytest.fail(f"Unauthenticated request reached database operation: {name}")


@pytest.mark.parametrize("path", PROTECTED_GET_PATHS)
@pytest.mark.parametrize("credential", ["anonymous", "basic", "invalid", "expired"])
def test_unauthorized_reads_stop_before_database_queries(monkeypatch, path, credential):
    monkeypatch.setitem(app.dependency_overrides, get_db, NoQueryDb)
    headers = {}
    if credential == "basic":
        headers["Authorization"] = "Basic dXNlcjpwYXNz"
    elif credential == "invalid":
        headers["Authorization"] = "Bearer invalid-token"
    elif credential == "expired":
        monkeypatch.setattr(
            security,
            "get_settings",
            lambda: SimpleNamespace(
                auth_secret_key="authorization-regression-test",
                auth_access_token_expire_minutes=-1,
            ),
        )
        token, _, _ = security.create_access_token(user_id=str(UUID(int=1)), role="customer")
        headers["Authorization"] = f"Bearer {token}"

    response = TestClient(app).get(path, headers=headers)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json()["code"] == "http_error"


@pytest.fixture
def authorized_records(monkeypatch):
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        users = [
            UserAccount(id=uuid4(), username=name, password_hash="unused", role="customer")
            for name in ("owner", "other")
        ]
        db.add_all(users)
        db.flush()
        viewer = AuthenticatedUser.from_model(users[0])
        projects = {}
        formal_reports = {}
        trial_reports = {}
        for label, creator, is_example in [
            ("own", users[0], False),
            ("other", users[1], False),
            ("example", users[1], True),
        ]:
            project = Project(
                id=uuid4(), project_no=f"PRJ-{label}", name=label,
                created_by=creator.id, is_example=is_example, status="reviewed",
                setup_completed_at=datetime.now(UTC),
            )
            report = InspectionReport(
                id=uuid4(), project_id=project.id, report_no=f"RPT-{label}",
                title=label, generated_by=creator.id, status="generated",
                report_data_json={"photos": [], "defects": []},
            )
            trial = TrialDetectionResult(
                id=uuid4(), result_no=f"TRY-{label}", title=label,
                generated_by=creator.id, is_example=is_example,
                report_data_json={"photos": [], "defects": []},
            )
            db.add_all([project, report, trial])
            db.flush()
            project.current_report_id = report.id
            projects[label] = project.id
            formal_reports[label] = report.id
            trial_reports[label] = trial.id
        db.commit()
        monkeypatch.setitem(app.dependency_overrides, get_db, lambda: db)
        monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: viewer)
        yield SimpleNamespace(
            client=TestClient(app), projects=projects,
            formal_reports=formal_reports, trial_reports=trial_reports,
        )
    engine.dispose()


def test_lists_include_only_owned_and_shared_example_records(authorized_records):
    records = authorized_records
    for path, ids in [
        ("/api/projects", records.projects),
        ("/api/reports?include_generated=true", records.trial_reports),
    ]:
        response = records.client.get(path)
        assert response.status_code == 200
        assert {item["id"] for item in response.json()} == {
            str(ids["own"]), str(ids["example"]),
        }


@pytest.mark.parametrize("label,expected_status", [("own", 200), ("example", 200), ("other", 404)])
@pytest.mark.parametrize("suffix", ["", "/photos", "/building-model", "/building-model-images", "/reviewed-result"])
def test_project_reads_enforce_object_access(authorized_records, label, expected_status, suffix):
    records = authorized_records
    response = records.client.get(f"/api/projects/{records.projects[label]}{suffix}")
    assert response.status_code == expected_status


@pytest.mark.parametrize("label,expected_status", [("own", 200), ("example", 200), ("other", 404)])
@pytest.mark.parametrize("source", ["formal_reports", "trial_reports"])
def test_report_reads_enforce_object_access(authorized_records, label, expected_status, source):
    records = authorized_records
    report_id = getattr(records, source)[label]
    response = records.client.get(f"/api/reports/{report_id}?include_generated=true")
    assert response.status_code == expected_status


@pytest.mark.parametrize("source,suffix", [("formal_reports", "/docx"), ("trial_reports", "/pdf")])
def test_downloads_reject_other_users_reports(authorized_records, source, suffix):
    records = authorized_records
    report_id = getattr(records, source)["other"]
    assert records.client.get(f"/api/reports/{report_id}{suffix}").status_code == 404


@pytest.mark.parametrize("method,suffix,payload", [("patch", "", {"title": "changed"}), ("delete", "", None), ("post", "/restore", None)])
def test_trial_report_mutations_reject_other_users_reports(authorized_records, method, suffix, payload):
    records = authorized_records
    response = records.client.request(
        method, f"/api/reports/{records.trial_reports['other']}{suffix}", json=payload,
    )
    assert response.status_code == 404
