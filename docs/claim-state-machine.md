# Claim state machine

State transitions are validated in `src/domain/claim-state.ts`, independently of HTTP handlers and LINE.

```mermaid
stateDiagram-v2
  [*] --> NEW
  NEW --> ELIGIBLE
  NEW --> EXPIRED
  NEW --> CANCELLED
  ELIGIBLE --> CLAIM_CREATED
  ELIGIBLE --> EXPIRED
  ELIGIBLE --> CANCELLED
  CLAIM_CREATED --> ACTIVITY_SENT
  CLAIM_CREATED --> IN_PROGRESS
  CLAIM_CREATED --> EXPIRED
  CLAIM_CREATED --> CANCELLED
  ACTIVITY_SENT --> IN_PROGRESS
  ACTIVITY_SENT --> PROOF_SUBMITTED
  ACTIVITY_SENT --> EXPIRED
  ACTIVITY_SENT --> CANCELLED
  IN_PROGRESS --> PROOF_SUBMITTED
  IN_PROGRESS --> EXPIRED
  IN_PROGRESS --> CANCELLED
  PROOF_SUBMITTED --> UNDER_REVIEW
  UNDER_REVIEW --> APPROVED
  UNDER_REVIEW --> REJECTED
  APPROVED --> REWARD_SENT
  REJECTED --> IN_PROGRESS : corrected evidence resubmission
```

`REWARD_SENT`, `EXPIRED`, and `CANCELLED` are terminal. A rejected claim can resume `IN_PROGRESS` when a customer selects an eligible activity and starts a new upload context. The previous rejected evidence and reason remain in history. Approval occurs only after every enabled required claim activity is approved. Approving proof does not send or record a reward; `REWARD_SENT` is outside Phase 4. Invalid transitions throw `DomainError` with code `INVALID_CLAIM_TRANSITION`.
