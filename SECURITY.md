# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Do not** open a public GitHub issue for security vulnerabilities.

Report privately using one of these:

1. [GitHub Security Advisories](https://github.com/false200/Tooltrim/security/advisories/new) (preferred)
2. Contact the maintainer through their [GitHub profile](https://github.com/false200)

## What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact (e.g. credential leak, arbitrary code execution)
- Suggested fix or mitigation, if you have one

## Response Timeline

| Step              | Target        |
| ----------------- | ------------- |
| Acknowledgement   | 72 hours      |
| Status update     | 7 days        |
| Fix or mitigation | Best effort   |

## Scope

In scope:

- The `tooltrim` npm package and CLI
- This repository's source code
- Default configuration and documented deployment patterns

Out of scope:

- Vulnerabilities in upstream MCP servers you connect via config
- Misconfiguration of secrets in user-owned `tooltrim.config.yaml` files
- Issues in third-party dependencies (report those to the upstream project; we will bump deps when fixes are available)

Thank you for helping keep Tooltrim and its users safe.
