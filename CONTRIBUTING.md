## Gittensor Hub Contributor Guide

### Getting Started

Before contributing, please:

1. Read the [README](./README.md) to understand the project
2. Familiarize yourself with the tech stack (Next.js 14, TypeScript, Primer React, SQLite)
3. Check existing issues, PRs, and discussions to avoid duplicate work

### Local Development

1. Ensure you have Node 20+ and [pnpm](https://pnpm.io/) installed
2. Clone the repo and run `pnpm install`
3. Copy `.env.local.example` to `.env.local` and fill in the values (see the [Setup section in the README](./README.md#github-setup) for GitHub OAuth + PAT instructions)
4. Run `pnpm dev` to start the development server on `http://localhost:12074`

### Creating Issues

Click **New issue** on GitHub and one of these templates will load automatically:

* **[Bug Report](./.github/ISSUE_TEMPLATE/bug_report.md)** — Report bugs or unexpected behavior. Include steps to reproduce, expected vs. actual behavior, and environment details.
* **[Feature Request](./.github/ISSUE_TEMPLATE/feature_request.md)** — Suggest new features or improvements. Explain the motivation and the proposed solution.
* **Open a blank issue** — For issues that don't fit the above templates.

For security vulnerabilities, **do not create a public issue**. Report them privately via [GitHub Security Advisories](https://github.com/MkDev11/gittensor-hub/security/advisories/new) — see [SECURITY.md](./SECURITY.md).

### Lifecycle of a Pull Request

#### 1. Create Your Branch

* Fork the repository, then branch off of `main` and target `main` with your PR
* Use a descriptive branch name (e.g. `fix/issue-42-rate-limit`, `feat/issue-stale-filter`)
* Ensure there are no conflicts with `main` before submitting

#### 2. Make Your Changes

* Write clean, well-documented code
* Follow existing code patterns and architecture
* Update documentation if applicable
* Do NOT add comments that are over-explanatory or redundant
* When making your changes, ask yourself: will this raise the value of the repository?
* Ensure `pnpm build` passes before submitting

#### 3. Submit Pull Request

1. Push your branch to your fork
2. Open a PR targeting the `main` branch of `MkDev11/gittensor-hub`
3. The [PR template](./.github/PULL_REQUEST_TEMPLATE.md) loads automatically — fill in:
   * **Summary** — Clear description of changes
   * **Related Issues** — Link issues using `Fixes #123` or `Closes #456`
   * **Type of Change** — Bug fix, new feature, refactor, documentation, or other
   * **Testing** — Confirm manual testing performed (browser smoke test if UI, build pass otherwise)
   * **Checklist** — Self-review, no unrelated changes, docs updated if needed

#### 4. Code Review

* Maintainers will review and may request changes
* Address review comments by pushing additional commits to the same branch (no force-push during review unless asked)

### PR Labels

Apply appropriate labels to help categorize and track your contribution:

* `bug` — Bug fixes
* `feature` — New feature additions
* `enhancement` — Improvements to existing features
* `refactor` — Code refactoring without functionality changes
* `documentation` — Documentation updates

### Code Standards

#### Quality Expectations

* Follow repository conventions (commenting style, variable naming, file layout)
* Use sensible component decomposition to keep files manageable
* Write clean, readable, maintainable code
* Avoid modifying unrelated files
* Avoid adding unnecessary dependencies
* Ensure `pnpm build` passes (TypeScript compilation + Next.js build)

#### Pre-submission check

Make sure the project still builds — this covers TypeScript and Next.js compilation:

```
pnpm build
```

### Branches

#### `main`

**Purpose**: Production-ready code — runs the live dashboard

**Restrictions**:

* Requires pull request
* Requires build to pass
* Requires maintainer approval before merge

### License

By contributing to Gittensor Hub, you agree that your contributions will be licensed under the project's license (MIT).

---

Thank you for contributing to Gittensor Hub and helping advance open source software development!
