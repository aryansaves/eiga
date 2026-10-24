# EIGA Decisions

## ADR-001 — Web first

Status: accepted

Reason: zero-install access, sharing, discoverability, and natural fit for visual demos.

## ADR-002 — Local Letterboxd import

Status: accepted

Reason: privacy and zero backend cost.

## ADR-003 — No Letterboxd scraping

Status: accepted

Reason: brittle, unnecessary, and not aligned with a user-controlled import workflow.

## ADR-004 — D3 first

Status: accepted

Reason: custom interaction and precise visual control.

## ADR-005 — No AI in core product

Status: accepted

Reason: deterministic, free to operate, privacy-friendly, and unnecessary for the core value.

## ADR-006 — No backend/database in V1

Status: superseded for optional signed-in persistence; anonymous use remains local

Reason: prove the visualization before adding operational complexity.

The authentication experiment keeps raw parsing and graph generation in the
browser. A separate eiga-persistent repository provides same-origin Pages APIs
for Google sign-in, normalized-library storage, and revocable links to the latest
saved map including reviews. One D1 database uses fixed staging/production tables
and independent migration ledgers. CI assembles the two repos and tests staging
before the backend release manifest can enable production.

## ADR-007 — Cinematic observatory visual language

Status: accepted

The Japanese name does not imply Japanese visual decoration.

## ADR-008 — EIGA is provisional

Status: provisional

映画 (えいが / eiga) is the standard Japanese word for film/movie. Before public launch, verify searchability, domains, repositories, package names, and trademark conflicts.
