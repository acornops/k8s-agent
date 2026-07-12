# Actionable Kubernetes Tool Errors

## Goal

Make AgentK tool failures actionable to the assistant without exposing raw Kubernetes responses, improve the read/patch tool guidance, and cover the repairable demo image workflow in the local full-stack smoke test.

## Scope

- Map Kubernetes not-found, forbidden, timeout, and unavailable responses to stable tool error codes with sanitized context.
- Clarify `get_resource` and `patch_resource` descriptions, including exact-name and guarded-read requirements.
- Extend the local-only deployment smoke to drive the seeded `ImagePullBackOff` workload through assistant approval and a healthy rollout.

## Validation

- AgentK unit, contract, harness, and validation suites.
- Deployment contract, harness, and validation suites.
- Local remediation smoke when the full stack and a configured model provider are available.

## Outcome

- AgentK validation passed, including 200 unit tests, contracts, harness, Helm checks, and build.
- Deployment validation passed.
- The live local remediation scenario reached `ImagePullBackOff`, produced and approved a guarded `patch_resource` call, recorded successful execution, and verified a healthy rollout.
- The remaining full-stack smoke later failed on an unrelated missing `knowledge-bank` HTTP route.
