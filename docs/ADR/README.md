# Architecture Decision Records

ADRs document important technical decisions and the reasoning behind them.

## Location

All ADRs are stored in `docs/ADR/`.

## Naming

Use:

`XXXX-short-decision-title.md`

Example:

`0001-use-official-node-images-for-development.md`

Numbers are sequential and never reused.

## Creating an ADR

1. Copy `ADR-TEMPLATE.md`.
2. Assign the next ADR number.
3. Describe the context, decision, and consequences.
4. Open the ADR as part of the related Pull Request.
5. Once agreed by the team, change its status to `Accepted`.

## Rules
- ADRs should remain short and should only be created for decisions that are useful to understand later.
- Each ADR documents an important technical decision:
	- context;
	- decision;
	- alternatives;
	- consequences.
