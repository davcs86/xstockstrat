# Product Spec: social-copy-trading

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Add a multi-user social layer where traders can publish their strategy performance, and other users can subscribe to automatically mirror their trades in real time (copy trading). Target network effects: the platform becomes more valuable as more traders join.

## Why It Seems Valuable

- Copy trading platforms (eToro, ZuluTrade, Collective2) have demonstrated product-market fit.
- The existing identity service handles multi-user auth; the ledger already records all fills.
- It appears to be an additive layer on top of the existing single-user architecture.

## Why It Is Not Worth Building

**1. It creates regulated financial products.**
Publishing trade performance to attract followers and enabling others to automatically copy trades constitutes investment advice in most jurisdictions. In the United States this triggers:
- SEC Registered Investment Adviser (RIA) requirements under the Investment Advisers Act of 1940.
- FINRA oversight if compensation is involved.
- Strict performance advertising rules (GIPS, SEC Marketing Rule) — showing past returns requires specific disclosures, time periods, and gross-vs-net reporting.

These are not documentation tasks. Non-compliance carries civil and criminal liability. Legal counsel and compliance infrastructure would consume more resources than the entire technical platform.

**2. The architecture is single-tenant by design — multi-tenancy is a ground-up redesign.**
Every service currently assumes one user context (`x-user-id` is a trace header, not a data partition key). Making signal ownership, position data, ledger events, and strategy configs properly isolated across multiple users requires:
- Tenant ID propagation across all 14 services
- Row-level security on every TimescaleDB table
- Signal source registry partitioned by owner
- Identity service extended with user roles, strategy visibility permissions, and follower relationships
- Analysis service scoring scoped per strategy owner

This is not additive — it is a full re-architecture.

**3. It dilutes the core value proposition before it is proven.**
The platform has not yet validated that its autonomous signal pipeline produces profitable trades in live conditions. Building social infrastructure on top of an unvalidated strategy engine would expose followers to losses from a system that has not earned trust.

**4. Abuse and gaming surface.**
Copy trading platforms attract strategy gaming (inflated paper returns, survivorship bias in published strategies, front-running by strategy publishers). Preventing this requires additional monitoring infrastructure that adds ongoing operational burden.

## Conditions Under Which This Should Be Reconsidered

- The platform has operated profitably in live trading for 12+ months with auditable track record.
- Legal counsel has confirmed a compliant path (e.g., operating as a technology provider rather than an investment adviser, with appropriate disclaimers and user agreements).
- A dedicated compliance team is in place to manage ongoing regulatory obligations.
- Multi-tenancy has been implemented as a prerequisite — not as part of this feature.

## Affected Services

_Not applicable — demoted before any design._
