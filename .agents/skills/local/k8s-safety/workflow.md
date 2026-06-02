# K8s Safety Workflow

1. Inspect `deploy/rbac.yaml` for new verbs/resources.
2. Validate tool implementations guard against broad destructive operations.
3. Confirm environment defaults keep write mode off unless explicitly enabled.
4. Run lint/unit tests and execute targeted e2e checks for changed tools.
5. Validate websocket lifecycle in local compose or cluster test setup.
6. Summarize any operational runbook updates required.
