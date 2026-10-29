# Security

This project is an independent retrieval server. It connects only to the MongoDB instance configured by its operator and does not connect to private Zelvora services.

Production mode requires a bearer API key, but that is a minimal access control rather than a complete internet-facing security layer. Deploy behind TLS, rate limiting, network controls, monitoring, and backups. Do not share a MongoDB database with the private Brain service.

Do not commit customer documents, MongoDB credentials, API keys, access tokens, or private evaluation data. When the GitHub repository is attached, report vulnerabilities privately through GitHub Security Advisories rather than a public issue.

The included `HashEmbeddingProvider` is deterministic example code. It is not a semantic model and should not be used as a security or quality boundary.
