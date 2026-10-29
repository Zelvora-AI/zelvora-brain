# Changelog

## 0.1.0

- Initial independent retrieval toolkit.
- Added deterministic chunking, BM25, in-memory vector search, hybrid reciprocal-rank fusion, citations, and retrieval metrics.
- Added an independent Express server, MongoDB document persistence, bearer access control, CRUD/search APIs, readiness checks, and live server acceptance coverage.
- Replaced document storage with the exact Artifact Brain `brain_chunks` schema and a scope-aware candidate retrieval API for private-service consumption.
