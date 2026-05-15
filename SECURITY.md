# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Gittensor Hub or any of its components, please report it responsibly.

**Do not open a public issue.** Public reports give attackers a head start while the fix is being developed.

### How to Report

Use **GitHub Security Advisories** (private, encrypted, tracked):

[Report a vulnerability →](https://github.com/MkDev11/gittensor-hub/security/advisories/new)

### What to Include

The more detail you provide, the faster we can act:

- Affected component / file paths
- Commit hash or branch you tested against
- Description of the vulnerability
- Steps to reproduce (proof-of-concept welcome)
- Impact assessment (what an attacker could do)
- Any suggested mitigations

---

## Response Process

1. Acknowledgement within **48 hours**
2. Investigation and confirmation of the issue
3. If confirmed, a fix is developed and tested in private
4. Coordinated disclosure once the fix is released
5. Credit in the release notes (if you wish)

---

## Scope

In scope:

- Authentication / session handling (OAuth, session cookies, admin-approval gating)
- GitHub PAT / OAuth secret handling
- SQL injection or unsafe SQLite query patterns
- XSS in rendered issue / PR bodies, markdown, or user-supplied content
- CSRF in state-changing endpoints
- Privilege escalation between regular and admin users
- Server-side request forgery via repo URL inputs

Out of scope:

- Vulnerabilities in third-party dependencies that have already been patched upstream — please report to the upstream project
- Issues that require physical access to the host machine
- Self-XSS or attacks requiring the victim to disable browser security features
- Rate-limit / DoS reports against a single deployment without a working PoC

---

Thank you for helping keep Gittensor Hub secure.
