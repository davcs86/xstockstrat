# Order Approval Flow Runbook

## Overview

Orders that exceed configured thresholds (qty or notional) are placed in `ORDER_STATUS_PENDING_APPROVAL` and require explicit human approval before submission to the broker. This runbook documents the full flow, approval mechanics, and escalation paths.

---

## Approval Trigger Conditions

Conditions are evaluated in `xstockstrat-trading` using config keys (namespace: `trading`):

| Condition | Config Key | Default |
|---|---|---|
| Quantity exceeds threshold | `trading.approval.require_above_qty` | `500` |
| Notional USD exceeds threshold | `trading.approval.require_above_notional` | `50000` |
| Strategy flag overrides | `trading.approval.always_require_for_strategy_ids` | (empty) |
| Platform maintenance mode | `platform.maintenance_mode` | `false` |

If **either** the qty or notional threshold is exceeded, the order enters approval flow.

---

## Flow Diagram

```
PlaceOrder RPC called
       │
       ▼
Threshold check
  ├── BELOW threshold → submit to broker immediately → ORDER_STATUS_NEW
  └── ABOVE threshold → set ORDER_STATUS_PENDING_APPROVAL
                              │
                              ▼
                    Write to ledger: order.approval_requested
                              │
                              ▼
                    EmitAlert (xstockstrat-notify)
                      severity: WARNING
                      category: approval
                      title: "Order requires approval"
                              │
                              ▼
                    Wait (order sits in pending state)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
    Approved (via API / agent)         Rejected / Timeout
            │                                   │
            ▼                                   ▼
  Submit to broker              Cancel order, emit alert
  Write: order.approved         Write: order.rejected
```

---

## Approval Mechanisms

### 1. Direct API (recommended for programmatic approval)
```
POST /api/v1/orders/{order_id}/approve
Authorization: Bearer <admin_jwt>
Body: { "approved_by": "user@example.com", "reason": "reviewed and approved" }
```

### 2. Agent / Webhook Trigger
- Webhook: `POST /webhooks/approve-order`
- Payload: `{ "order_id": "...", "approved_by": "...", "reason": "..." }`
- Agent or external caller: receives approval notification → reviewer approves → posts to webhook

### 3. xstockstrat-trader UI
- Pending approvals appear in the Orders tab with status `PENDING_APPROVAL`
- Approvers with the `orders:approve` scope see an **Approve / Reject** button
- Action calls `POST /api/orders/{id}/approve` Route Handler

---

## Timeout Policy

| Config Key | Default | Behaviour |
|---|---|---|
| `trading.approval.timeout_minutes` | `60` | After this time, pending orders are auto-cancelled |
| `trading.approval.escalate_after_minutes` | `30` | If no action after 30 min, re-alert with CRITICAL severity |

---

## Approval Roles

Only users with `orders:approve` JWT scope may approve orders. Scopes are managed in `xstockstrat-identity`.

Approval of orders above `5× notional threshold` requires **two approvers** (approver1 submits, approver2 countersigns).

---

## Ledger Events in This Flow

| Event Type | Stream Key | Written By |
|---|---|---|
| `order.created` | `order:{id}` | xstockstrat-trading |
| `order.approval_requested` | `approval:{id}` | xstockstrat-trading |
| `order.approved` | `approval:{id}` | xstockstrat-trading |
| `order.rejected` | `approval:{id}` | xstockstrat-trading |
| `order.approval_timeout` | `approval:{id}` | xstockstrat-trading (scheduler) |

---

## Alert Checklist for Operators

When you receive an approval alert:
- [ ] Verify order parameters (symbol, side, qty, notional)
- [ ] Check current portfolio exposure in xstockstrat-portfolio
- [ ] Review strategy signal in xstockstrat-insights
- [ ] Check market conditions in xstockstrat-marketdata
- [ ] Approve or reject via one of the mechanisms above
- [ ] If rejecting, provide a reason (written to ledger)

---

## Config Rollout for Threshold Changes

To adjust approval thresholds, follow `docs/runbooks/config-rollout.md`. Changes to `trading.approval.*` keys take effect immediately on all active WatchConfig subscribers (no restart required).
