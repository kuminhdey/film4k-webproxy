# ECC for Gemini CLI

This file provides Gemini CLI with the baseline ECC workflow, review standards, and security checks for repositories that install the Gemini target.

## Overview

ECC is a cross-harness coding system with 71 specialized agents, 311 skills, and 97 commands.

Gemini support is currently focused on a strong project-local instruction layer via `.gemini/GEMINI.md`, plus the shared MCP catalog and package-manager setup assets shipped by the installer.

## Core Workflow

1. Plan before editing large features.
2. Prefer test-first changes for bug fixes and new functionality.
3. Review for security before shipping.
4. Keep changes self-contained, readable, and easy to revert.

## Coding Standards

- Prefer immutable updates over in-place mutation.
- Keep functions small and files focused.
- Validate user input at boundaries.
- Never hardcode secrets.
- Fail loudly with clear error messages instead of silently swallowing problems.

## Security Checklist

Before any commit:

- No hardcoded API keys, passwords, or tokens
- All external input validated
- Parameterized queries for database writes
- Sanitized HTML output where applicable
- Authz/authn checked for sensitive paths
- Error messages scrubbed of sensitive internals

## Delivery Standards

- Use conventional commits: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`
- Run targeted verification for touched areas before shipping
- Prefer contained local implementations over adding new third-party runtime dependencies

## ECC Areas To Reuse

- `AGENTS.md` for repo-wide operating rules
- `skills/` for deep workflow guidance
- `commands/` for slash-command patterns worth adapting into prompts/macros
- `mcp-configs/` for shared connector baselines

## Orca Task Delegation Rule (MANDATORY & GLOBAL)

- **VAI TRÒ AGENT CHÍNH (ORCA MAIN AGENT):**
  - **TUYỆT ĐỐI KHÔNG** tự code hay trực tiếp làm các nhiệm vụ thực thi kỹ thuật.
  - **CHỈ ĐÓNG VAI TRÒ ĐIỀU PHỐI & GIÁM SÁT:** Phân tích yêu cầu, chia nhỏ task, tạo các Orca children worktree tương ứng, giao việc và theo dõi tiến độ của các children.
- **QUY TẮC THI HÀNH TẠI CÁC CHILDREN WORKTREE:**
  - **TUYỆT ĐỐI KHÔNG** dùng `invoke_subagent` hay subagent ảo.
  - Phải ủy quyền và thực thi trực tiếp trong các **Orca children worktrees** (`~/orca/workspaces/webproxy/*`).
  - **BẮT BUỘC DÙNG `agy`:** Khi sử dụng Antigravity tại các children worktree, **BẮT BUỘC PHẢI DÙNG `agy`** (chạy interactive terminal: `agy -i "<chi_tiet_nhiem_vu>" --dangerously-skip-permissions`) để người dùng thấy rõ tab `agy` và tiến trình làm việc trực tiếp trong ứng dụng Orca.
- **ĐỒNG BỘ MÃ NGUỒN:**
  - Đồng bộ tất cả worktrees bằng lệnh `git fetch origin main && git reset --hard origin/main` sau mỗi commit được đẩy lên `origin/main`.

