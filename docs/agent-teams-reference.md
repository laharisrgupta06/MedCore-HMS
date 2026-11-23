# Claude Code Agent Teams: Master Reference

> **Status of this document:** compiled on 2026-11-16 from the official Claude Code documentation at `code.claude.com/docs/en/`. Agent teams are **experimental**. Behaviour, flags and version requirements change quickly, so re-check the pages in [Sources](#19-sources-and-how-to-re-verify) before relying on a detail. Where the official pages did not give a detail (or I could not retrieve it), this document says so under [Gaps](#18-gaps-and-unverified-items) instead of guessing.
>
> **Project:** MedCore HMS. Section 16 applies everything here to this repository.

---

## Contents

1. [What agent teams are](#1-what-agent-teams-are)
2. [Agent teams vs subagents vs other options](#2-agent-teams-vs-subagents-vs-other-options)
3. [Architecture and orchestration](#3-architecture-and-orchestration)
4. [Enabling and configuring](#4-enabling-and-configuring)
5. [Settings, environment variables and CLI flags](#5-settings-environment-variables-and-cli-flags)
6. [Creating, naming and spawning teammates](#6-creating-naming-and-spawning-teammates)
7. [Models and effort levels](#7-models-and-effort-levels)
8. [Display modes and terminal setup](#8-display-modes-and-terminal-setup)
9. [Communication and messaging](#9-communication-and-messaging)
10. [Shared task list, dependencies and task management](#10-shared-task-list-dependencies-and-task-management)
11. [Permissions and inheritance](#11-permissions-and-inheritance)
12. [File ownership and avoiding conflicts](#12-file-ownership-and-avoiding-conflicts)
13. [Hooks and quality gates](#13-hooks-and-quality-gates)
14. [Context management and token cost](#14-context-management-and-token-cost)
15. [Shutdown, sessions and limitations](#15-shutdown-sessions-and-limitations)
16. [Applying this to MedCore HMS](#16-applying-this-to-medcore-hms)
17. [Best practices, troubleshooting and examples](#17-best-practices-troubleshooting-and-examples)
18. [Gaps and unverified items](#18-gaps-and-unverified-items)
19. [Sources and how to re-verify](#19-sources-and-how-to-re-verify)

---

## 1. What agent teams are

An agent team is a group of Claude Code sessions that work together. One session is the **team lead**: it spawns teammates, assigns work, and synthesises results. Each **teammate** is a separate, full Claude Code session with its own context window. Teammates can message each other directly, and you can message any teammate yourself without going through the lead.

**Status:** experimental and **disabled by default**. Without `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, no team is set up at session start, no team directories are written, and Claude does not spawn or propose teammates.

**Strongest use cases (per the docs):**

| Use case | Why teams help |
| --- | --- |
| Research and review | Teammates investigate different aspects at once, then share and challenge findings |
| New modules or features | Each teammate owns a separate piece |
| Debugging with competing hypotheses | Parallel theories, teammates try to disprove each other |
| Cross-layer work | Frontend, backend and tests each owned by a different teammate |

**Weak use cases:** sequential tasks, edits to the same file, work with many dependencies. Use a single session or subagents there.

---

## 2. Agent teams vs subagents vs other options

| | Subagents | Agent teams |
| --- | --- | --- |
| Context | Own window; result returns to the caller | Own window; fully independent |
| Communication | Return a result to the caller. Subagents Claude has *named* can also message each other | Teammates message each other directly |
| Coordination | Main agent manages all work | Self-coordination by messages, plus a shared task list for agents that have the Task tools |
| Best for | Focused tasks where only the result matters | Complex work needing discussion and collaboration |
| Token cost | Lower (results summarised back) | Higher (each teammate is a separate Claude instance) |

**Decision guide**

| Situation | Use |
| --- | --- |
| Quick lookup, verbose test or log output you do not want in main context, a self-contained task that returns a summary | **Subagent** |
| Frequent back-and-forth, several phases sharing context, a small targeted change, latency matters | **Main conversation** |
| Parallel investigators who must debate, or parallel owners of separate modules who must coordinate | **Agent team** |
| Several independent sessions you run yourself that pass findings | **Cross-session messaging** |
| Parallel sessions with no automated coordination | **Git worktrees** (`claude --worktree <name>`) |
| Reusable prompt or workflow in the current context | **Skill** |

Other options the subagent docs list: `/btw` (a question about the existing conversation, no tools), background agents (many independent sessions monitored from one place).

**Rule of thumb:** start with the cheapest option that does the job. Teams add coordination overhead and significantly more tokens.

---

## 3. Architecture and orchestration

### Components

| Component | Role |
| --- | --- |
| Team lead | The main session. Spawns teammates, coordinates, fixed for the session's lifetime |
| Teammates | Separate Claude Code instances working on assigned tasks |
| Task list | Shared list of work items teammates claim and complete |
| Mailbox | Messaging between agents |

### On-disk layout

| Item | Location | Lifetime |
| --- | --- | --- |
| Team config | `~/.claude/teams/{team-name}/config.json` | Removed when the session ends |
| Mailboxes | `~/.claude/teams/{team-name}/inboxes/{agent-name}.json` | Same directory as the team config |
| Task list | `~/.claude/tasks/{team-name}/` | **Stays on disk** after the session; retention follows `cleanupPeriodDays` |

- `{team-name}` is `session-` plus the first eight characters of the session ID.
- Do **not** hand-edit or pre-author the team config. It holds runtime state (session IDs, tmux pane IDs) and is overwritten on the next state update.
- There is **no project-level team config**. A file such as `.claude/teams/teams.json` is not recognised; Claude treats it as an ordinary file. Reusable roles come from **subagent definitions**, not team files.
- The `members` array in the config lists each member's name and agent ID. The lead's entry has type `team-lead`; a teammate's entry carries whatever agent type the lead named (a built-in type or a subagent definition), or omits it.
- Claude Code validates every mailbox entry when reading. Invalid entries are reported as errors and removed; valid messages are still delivered.
- A message counts as sent only when the write to the recipient's mailbox file succeeds. On failure (disk full, directory not writable) the sender gets an error and nothing is sent.

### How a team starts

Claude launches a teammate when it calls the **Agent tool with a `name`** while agent teams are enabled, unless the call is a fork or passes `isolation` on the call itself. Claude Code does **not** ask you to confirm the launch. Claude also names ordinary subagents on its own so it can message them later, which means **teams can form even when you did not ask for one** once the feature is on (see [turning it off](#claude-spawns-teammates-instead-of-subagents)).

Claude may also choose subagents instead of a team. Subagents show in the same agent panel as teammates, so the panel alone does not prove a team formed. If you want a team, ask for an "agent team" explicitly.

### Dependency handling

Claude Code manages task dependencies automatically: when a teammate completes a task that others depend on, the dependents unblock without any action from you.

### Hard structural rules

- One team per session; no additional named teams; no sharing across sessions.
- No nested teams: teammates cannot spawn teammates. Only the lead manages the team.
- The lead cannot be changed or promoted.

---

## 4. Enabling and configuring

### Enable

Either export the variable in your shell or put it in a settings file's `env` block:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

```bash
# one-off, shell only
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude
```

**This project** already has the setting in `.claude/settings.local.json` (personal, not meant to be committed). To share it with collaborators put the same block in `.claude/settings.json`.

### Requirements and conditions

- Spawning teammates needs an **interactive session**. In non-interactive mode (`claude -p`, including Agent SDK sessions) Claude does not spawn teammates, and a subagent it names runs as an ordinary subagent.
- Settings precedence applies to this variable like any other `env` value. A `0` in user settings overrides a shell export, but project settings, local settings, a `--settings` payload and managed settings are applied afterwards and can set it back to `1`.

### Claude spawns teammates instead of subagents

While teams are enabled, a subagent Claude names launches as a teammate. To restore normal subagent behaviour, set the variable to `0`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "0"
  }
}
```

No restart is needed: settings-file `env` changes are re-applied to the running session on save, and the variable is re-read each time Claude spawns a subagent. Named subagents still work as `SendMessage` addresses afterwards, and Claude still receives each subagent's result when it completes. If your organisation enables teams in managed settings, only an administrator can change that value.

### Verify it is on

There is no dedicated "teams status" command in the docs I could access. Practical checks: ask Claude for an agent team and confirm teammates appear in the agent panel below the prompt input, and that `~/.claude/teams/session-xxxxxxxx/config.json` appears while the session runs. See [Gaps](#18-gaps-and-unverified-items).

---

## 5. Settings, environment variables and CLI flags

### Settings keys

| Key | Where | Values / notes |
| --- | --- | --- |
| `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | any settings file | `"1"` on, `"0"` off |
| `teammateMode` | any settings file, e.g. `~/.claude/settings.json` | `"in-process"` (default), `"auto"`, `"tmux"`, `"iterm2"` |
| `subagentPromptCacheTtl` | any settings file | `"5m"` or `"1h"`; default unset. Applies to subagents, workflows and background/helper requests including in-process teammates. Requires v2.1.242+ |
| `cleanupPeriodDays` | any settings file | How long Claude Code keeps session data, including `~/.claude/tasks/`. Reports elsewhere in the docs describe a 30-day default; confirm in the settings reference |
| `effortLevel` | any settings file | `"low"`, `"medium"`, `"high"`, `"xhigh"` (not `max`). Default for models without a saved per-model level |
| `modelSettings` | any settings file | Per-model object with `effortLevel`, `maxEffortLevel`, `autoCompactWindow` (100000 to 1000000 or `"auto"`). Saved levels need v2.1.251+ |
| `maxEffortLevel` | any settings file | Caps effort; `"max"` means no cap. Requires v2.1.267+ |
| `availableModels` | managed/policy settings | Allowlist (family, version prefix or full ID). Applies to teammate models too |
| `permissions.allow` / `permissions.deny` | settings files | Pre-approve or deny tool rules; inherited as described in section 11 |
| `hooks` | settings files, skills, subagent frontmatter | See section 13 |
| **Removed:** `teammateDefaultModel` | | Removed in v2.1.234; leftover values are ignored. Name the model in your prompt instead |

### Environment variables

| Variable | Effect |
| --- | --- |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `1` enables agent teams (experimental, off by default) |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Model for subagents and teammates when not `inherit`; third in the teammate model order (section 7) |
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` | Forces every teammate's model from `CLAUDE_CODE_SUBAGENT_MODEL` (or the lead's model if unset/`inherit`). Requires v2.1.257+ |
| `CLAUDE_CODE_EFFORT_LEVEL` | `low`, `medium`, `high`, `xhigh`, `max`, or `auto`. Highest precedence for effort |
| `CLAUDE_CODE_ENABLE_TASKS` | `0` switches the Task tools back to the legacy `TodoWrite` tool |
| `CLAUDE_CODE_ENABLE_TODO_TOOLS` | `1` provides the Task tools on every model. Requires v2.1.233+ |
| `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` | Per-session override for the subagent cache TTL |
| `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | Cap on simultaneously running subagents (default 20). v2.1.217+ |
| `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | Subagent nesting depth (default 3) |
| `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1` | Remove the built-in Explore and Plan subagents. v2.1.198+ |

### CLI flags and commands

| Flag / command | Purpose |
| --- | --- |
| `--teammate-mode <in-process\|auto\|tmux\|iterm2>` | Display mode for this session; overrides `teammateMode`. The agent-teams page notes it is experimental and absent from `claude --help`; the CLI reference does list it |
| `--model <alias or ID>` | Lead's model for the session (aliases `sonnet`, `opus`, `haiku`, `fable`, or a full ID) |
| `--effort <level>` | Session effort: `low`, `medium`, `high`, `xhigh`, `max`, or `ultracode` (v2.1.203+); not persisted |
| `--permission-mode <mode>` | `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, `manual` |
| `--dangerously-skip-permissions` | Same as `bypassPermissions`; **all teammates inherit it** |
| `--allowedTools` / `--disallowedTools` / `--tools` | Tool allow, deny and restriction rules; inheritance differs by display mode (section 11) |
| `--settings <file or JSON>` | Per-session settings; the way to pre-approve rules for split-pane teammates |
| `--setting-sources user,project,local` | Restrict loaded sources; teammates inherit the restricted list (split-pane too from v2.1.281) |
| `--agents '<json>'` | Define subagents for this session only (file form with `--print` needs v2.1.281+) |
| `--agent <name>` | Run the session as a given agent |
| `--add-dir <path>` | Extra working directories (file access, not configuration discovery) |
| `-w`, `--worktree [name]` | Start in an isolated git worktree |
| `-n`, `--name` | Name the session for `/resume` |
| `-c`, `--continue`, `-r`, `--resume` | Continue or resume sessions (**in-process teammates are not restored**) |
| `-p` | Non-interactive; teammates are **not** spawned |
| `--debug`, `--debug-file` | Diagnostics (useful for hook debugging) |

**In-session keys and commands (in-process mode)**

| Input | Action |
| --- | --- |
| Up / Down in the agent panel | Select a teammate |
| Enter | Open the selected teammate's transcript and message it |
| Esc | Clear selection; while viewing a teammate, interrupts its current turn |
| `x` on a selected teammate | Stop it |
| Ctrl+T | Toggle the task list |
| Shift+Tab (viewing a teammate) | Put that running teammate in plan mode (lead then reviews its plan) |
| `/compact`, `/clear`, `/rewind` while viewing a teammate | Act on the **lead's** conversation; Claude Code asks you to confirm first |
| `/model`, `/fast` while viewing a teammate | Do not run; they would change the lead, and a teammate's model and fast mode are fixed at spawn |
| `/usage` | Session token and cost estimate |
| `/effort`, `/model` | Change effort or model for the lead |
| `/list-agents` | List agents Claude can message (needs cross-session messaging; v2.1.224+, teammate rows v2.1.239+) |

---

## 6. Creating, naming and spawning teammates

### Basic spawn (natural language)

```text
I'm designing a CLI tool that tracks TODO comments across a codebase. Spawn
three teammates to explore it from different angles: one on UX, one on
technical architecture, one playing devil's advocate.
```

### Specify count and model

```text
Spawn 4 teammates to refactor these modules in parallel. Use Sonnet for each teammate.
```

### Name teammates (recommended)

The lead assigns names at spawn time, and any teammate can message any other by that name. For predictable references, say what to call each one in the spawn instruction:

```text
Create a team with three teammates named api-dev, web-dev and qa. api-dev owns
apps/api, web-dev owns apps/web, qa owns test files only.
```

### Reuse a subagent definition as a teammate

Define a role once in `.claude/agents/` (project), `~/.claude/agents/` (user), managed settings, `--agents`, or a plugin, then name it when spawning:

```text
Spawn a teammate using the security-reviewer agent type to audit the auth module.
```

What Claude Code applies from the definition:

| Definition part | In-process teammate | Split-pane teammate |
| --- | --- | --- |
| `tools` | Applied; `SendMessage` added, plus `TaskCreate/Get/List/Update` where the session has Task tools | Applied |
| `model` | Used if the spawn prompt names none | Used if the spawn prompt names none |
| `disallowedTools` | Removed (but `SendMessage` and the added Task tools stay available) | Not stated |
| `effort` | Applied (frontmatter effort rules) | Not stated |
| `autoCompactWindow` | Applied (v2.1.296+) | Ignored |
| Body (instructions) | **Appended** to the default system prompt | **Replaces** the default system prompt |
| `skills` | **Not applied** in either mode; teammate loads skills from project and user settings | Same |
| `mcpServers` | Ignored; MCP servers come from project and user settings | Applied |

Subagent frontmatter fields (only `name` and `description` are required; unknown fields are silently ignored): `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `autoCompactWindow`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `omitClaudeMd`, `effort`, `isolation`, `color`, `initialPrompt`, `experimental`.

Example definition:

```markdown
---
name: security-reviewer
description: Reviews authentication and authorisation code for vulnerabilities
tools: Read, Grep, Glob
model: sonnet
effort: high
---
You review code for security issues. Report each finding with a severity,
file, line and a suggested fix. Do not edit files.
```

**Restoring teammates:** if Claude messages an in-process teammate that has stopped, Claude Code brings it back in the same session with its saved conversation. A definition from a project `.claude/agents/` or `--add-dir` directory is re-applied only if that exact folder is trusted; trusting a parent folder does not count. Until then the teammate returns with none of the definition's tools or instructions.

### What a teammate starts with

A teammate loads the same project context as a normal session: CLAUDE.md, MCP servers and skills. It also receives the lead's spawn prompt. **The lead's conversation history does not carry over**, so put task-specific facts in the spawn prompt.

---

## 7. Models and effort levels

### How a teammate's model is chosen

First match wins:

1. The model named for that teammate in your spawn prompt.
2. The subagent definition's `model` (`inherit` means the lead's model).
3. `CLAUDE_CODE_SUBAGENT_MODEL`, if set to anything other than `inherit`.
4. The lead's current model.

(Before v2.1.251 `CLAUDE_CODE_SUBAGENT_MODEL` came first.) If `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` (v2.1.257+), sources 1 and 2 are ignored. An installed mod's `agent.spawn` hook can override the first source.

**Allowlists:** the selected model is checked against `availableModels`. A blocked family alias (for example `opus`) becomes the newest permitted version of that family on the Anthropic API and Claude Platform on AWS. Any other blocked value falls back to the lead's model (after trying `CLAUDE_CODE_SUBAGENT_MODEL`). Teammate fallbacks are not reported to you.

**A teammate's model and fast mode are fixed at spawn.** `/model` and `/fast` do not change them.

### Effort

- Teammates **inherit the lead's effort level** by default. For split-pane teammates this applies from v2.1.186.
- A subagent definition's `effort` applies to in-process teammates spawned from it.
- Effort sources, highest precedence first: `CLAUDE_CODE_EFFORT_LEVEL` / `--effort` / `/effort`, then settings (`modelSettings`, `effortLevel`), then the model default. A `maxEffortLevel` cap or organisation cap still limits the result.
- Supported levels by model family (current docs): `low`, `medium`, `high`, `xhigh`, `max` on Fable 5.x, Opus 5.5, Sonnet 5.5, Haiku 5.5, Opus 5, Sonnet 5, Opus 4.8/4.7; `low`, `medium`, `high`, `max` on Opus 4.6 and Sonnet 4.6. An unsupported level runs as the highest supported one below it.
- Defaults: `high` on most models; `medium` on Opus 5.5, Sonnet 5.5 and Haiku 5.5; `xhigh` on Opus 4.7.

### Cost-oriented guidance from the docs

Use Sonnet for teammates (balance of capability and cost for coordination tasks); reserve Opus for complex architectural reasoning. A specific per-teammate effort cannot be set at spawn by a dedicated flag; control it through the lead's level or a subagent definition.

---

## 8. Display modes and terminal setup

| Mode | How it works | Requirements |
| --- | --- | --- |
| `in-process` (default) | All teammates inside your main terminal; arrow keys in the agent panel | Any terminal |
| `tmux` | Each teammate in its own pane; auto-detects tmux or iTerm2 | tmux, or iTerm2 with `it2` |
| `iterm2` | iTerm2 native split panes; errors with an install command if `it2` is missing | iTerm2 + `it2` CLI + Python API enabled |
| `auto` | Split panes if already inside tmux, or in iTerm2 with `it2` installed; otherwise in-process | none |

Set it persistently:

```json
{
  "teammateMode": "auto"
}
```

Or per session:

```bash
claude --teammate-mode auto
```

**Setup**

- tmux: install with your package manager (`brew install tmux` on macOS). The docs say tmux has limitations on some operating systems and works best on macOS; `tmux -CC` in iTerm2 is the suggested entry.
- iTerm2: install the [`it2` CLI](https://github.com/mkusaka/it2), then enable **iTerm2 > Settings > General > Magic > Enable Python API**.
- **Not supported for split panes:** VS Code's integrated terminal, Windows Terminal, Ghostty.

**Agent panel behaviour (in-process):** idle rows stay while any agent is working. Once all agents are idle, idle rows hide after 30 seconds and reappear on the teammate's next turn (the teammate keeps running and stays addressable). With more than three idle teammates the surplus collapses into an `N idle agents` row; Enter expands it, Esc collapses it. Working teammates, failed teammates and the one you are viewing keep their own rows.

---

## 9. Communication and messaging

- **Direct messaging:** any teammate can message any other, and you can message any teammate (select it and press Enter in in-process mode; click its pane in split mode). One message goes to one recipient; to reach everyone, send one message per recipient.
- **Automatic delivery:** messages are delivered without the lead polling.
- **Idle notifications:** when a teammate stops, it notifies the lead and includes its final answer. If its turn ends on an API error, the lead is told it failed, with the error text.
- **Waking a waiting teammate:** a message to an in-process teammate that is waiting to retry a failed API request makes it retry immediately.
- **Tools involved:** `SendMessage` (to teammates, resumable subagents by ID or name, or other sessions; optional `summary` shown as a one-line preview), `ListAgents`, `TaskStop` (also accepts a teammate by ID or name).
- **Trust model:** a `SendMessage` message is presented to the receiver as coming from another Claude session, not from you. A teammate cannot approve a permission prompt or give consent on your behalf, and a teammate denied an action cannot relay it to another teammate to bypass the check.
- **Auto mode:** the classifier treats relayed "approval" claims as untrusted input and reviews each message before delivery (including shutdown requests and plan approvals); a blocked message never arrives.
- **Mailbox errors:** see the "Failed to write to a teammate's inbox" entry in the official errors page for messages and recovery.

---

## 10. Shared task list, dependencies and task management

- **States:** pending, in progress, completed. A task can depend on others and shows as **blocked** until they complete. Teammates do not self-claim blocked tasks, but you or the lead can still assign them.
- **Assignment:** the lead assigns explicitly (you tell it who gets what), or a teammate **self-claims** the next unassigned, unblocked task after finishing one. Claiming uses **file locking** to avoid races.
- **Tools:** `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate` (status, dependencies, details, deletion). `Ctrl+T` toggles the task list view in in-process mode.
- **Sizing guidance:** aim for self-contained units with a clear deliverable (a function, a test file, a review). About 5 to 6 tasks per teammate keeps everyone productive and lets the lead reassign work when someone is stuck. If the lead is not creating enough tasks, ask it to split the work.

### Important availability caveat

The Task tools are provided **by default only on Opus 4.7, Sonnet 4.6, Haiku 4.5 and earlier models** (from v2.1.268). On newer models they are left out unless you opt in, and without them an agent coordinates through **messages only**, with no shared task list. Opt in with any one of:

```bash
CLAUDE_CODE_ENABLE_TODO_TOOLS=1 claude      # Task tools on every model (v2.1.233+)
claude --allowedTools TaskCreate            # naming a task tool opts the session in
# or list the Task tools in --tools alongside the other built-ins you use (the flag restricts built-in tools to the ones named)
```

An **in-process** teammate follows the lead session's availability; a **split-pane** teammate is a separate process whose own model decides. `CLAUDE_CODE_ENABLE_TASKS=0` swaps the Task tools for legacy `TodoWrite`.

**Known issue:** task status can lag. A teammate may fail to mark a task completed, blocking dependents. Check whether the work is really done, then update the status manually or ask the lead to nudge the teammate.

---

## 11. Permissions and inheritance

- Teammates start with the **lead's permission mode**, except `dontAsk`, which they do **not** inherit. If the lead uses `--dangerously-skip-permissions`, every teammate does too.
- You **cannot set per-teammate permission modes at spawn**. You can change an individual teammate's mode afterwards.
- Teammate permission prompts **surface in the lead session**; approve them there.

| Flag / rule | In-process teammate | Split-pane teammate |
| --- | --- | --- |
| `--disallowedTools`, `--tools` | Apply (runs under the lead's live allow and deny rules) | Teammate starts with the lead's command-line deny rules and tool list (v2.1.309+) |
| `--allowedTools` | Applies | **Not passed**; put rules under `permissions.allow` in `--settings` instead |

```bash
claude --settings '{"permissions":{"allow":["Bash(pnpm *)"]}}'
```

- **Plan approval:** a teammate spawned while the lead is in plan mode works read-only until its plan is ready, then sends an approval request to the lead. If you have not changed that teammate's permission mode, Claude Code approves the plan automatically when it arrives, without the lead reviewing it; the teammate's later edits and commands still go through normal prompts. If you put a running in-process teammate in plan mode yourself (Shift+Tab), the **lead** reviews that plan instead.
- **Reduce prompt friction:** pre-approve common safe operations in your permission settings before spawning.
- **Subagent `permissionMode` frontmatter** values: `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, `manual`. Whether it affects a teammate spawned from that definition is not stated in the pages I accessed, so do not rely on it.

---

## 12. File ownership and avoiding conflicts

The docs give one explicit rule: **two teammates editing the same file leads to overwrites**, so split work so each teammate owns a different set of files. There is no built-in file lock for source files (the file locking in the docs is for task claiming only).

Recommended practice:

1. Put the ownership map in the **spawn prompt** (directories or file globs per teammate, plus "read-only elsewhere").
2. Give shared contracts (types, DB schema, config) to **one owner**; others request changes by message.
3. Use `PreToolUse` hooks to enforce ownership mechanically if overwrites are a risk (see section 13).
4. Consider `isolation: worktree` in a subagent definition, or separate git worktrees, for work that must overlap in time. Check the official worktrees page for how this combines with teams, since the agent-teams page does not describe it.
5. Run package installs, lockfile changes, migrations and formatting by **one** agent only.
6. Merge order: let the lead integrate and run the full test suite after teammates finish.

---

## 13. Hooks and quality gates

Three hook events are specific to teams and tasks. **None support matchers**; they fire on every occurrence (a `matcher` field is ignored).

| Event | Fires when | Exit code 2 | JSON control |
| --- | --- | --- | --- |
| `TeammateIdle` | A teammate is about to go idle after its turn | stderr is fed back; the teammate keeps working | `{"continue": false, "stopReason": "..."}` stops the teammate |
| `TaskCreated` | A task is being created via `TaskCreate` | Creation is rolled back; stderr returned to Claude | `{"decision": "block", "reason": "..."}`; `continue:false` is ignored |
| `TaskCompleted` | A task is being marked complete (via `TaskUpdate`, or when a teammate ends its turn with in-progress tasks) | Completion is blocked; stderr is fed back | `continue:false` stops the teammate, but is ignored when `TaskUpdate` triggered the event |

**Input fields**

| Event | Fields (besides common ones such as `session_id`, `transcript_path`, `cwd`, `hook_event_name`) |
| --- | --- |
| `TeammateIdle` | `teammate_name`, `team_name` (deprecated), `agent_id` (v2.1.290+, may be absent) |
| `TaskCreated` | `task_id`, `task_subject`, `task_description` (optional), `teammate_name` (optional), `team_name` (deprecated), `agent_id` (v2.1.290+) |
| `TaskCompleted` | `task_id`, `task_subject`, `task_description` (optional), `teammate_name` (optional), `team_name` (deprecated), `agent_id` (v2.1.290+) |

Notes: the `onFailure: "block"` field has no effect on `TeammateIdle` and `TaskCompleted`. A `continueOnBlock` option exists in the hooks reference; for `TeammateIdle` the default is that the teammate stops and the reason appears as a warning, and setting `continueOnBlock: true` feeds the reason back so it keeps working. Verify the interaction with exit code 2 in the hooks page before depending on it.

### Configuration shape

```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/task-completed.sh" }
        ]
      }
    ],
    "TeammateIdle": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/teammate-idle.sh" }
        ]
      }
    ],
    "TaskCreated": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/task-created.sh" }
        ]
      }
    ]
  }
}
```

Hooks live in a settings file (`.claude/settings.json` to share with the team, `.claude/settings.local.json` for yourself). Debug with `/hooks` and `claude --debug-file ./claude-debug.txt`.

### Example gates (adapted from the official examples)

Block task completion while tests fail:

```bash
#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')
if ! pnpm test 2>&1; then
  echo "Tests not passing. Fix failing tests before completing: $TASK_SUBJECT" >&2
  exit 2
fi
exit 0
```

Require a naming convention on new tasks:

```bash
#!/bin/bash
INPUT=$(cat)
SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')
if [[ ! "$SUBJECT" =~ ^\[TICKET-[0-9]+\] ]]; then
  echo "Task subject must start with a ticket number, e.g. '[TICKET-123] Add feature'" >&2
  exit 2
fi
exit 0
```

Keep a teammate working until a build artefact exists:

```bash
#!/bin/bash
if [ ! -f "./dist/output.js" ]; then
  echo "Build artifact missing. Run the build before stopping." >&2
  exit 2
fi
exit 0
```

Scripts need `chmod +x` and `jq` installed.

---

## 14. Context management and token cost

- Every teammate has its **own context window**; usage scales roughly with the number of active teammates and how long each runs. The docs give no hard teammate limit.
- The costs page states agent teams use roughly **7x** the tokens of a standard session when teammates run in plan mode. Treat this as an order-of-magnitude warning, not a budget.
- **Cost controls from the docs:**
  - Use Sonnet for teammates.
  - Keep teams small (3 to 5 for most workflows; "three focused teammates often outperform five scattered ones").
  - Keep spawn prompts focused; everything in them enters the teammate's context from the start.
  - Shut teammates down when finished; active ones keep consuming tokens until they exit or the session ends.
  - Keep CLAUDE.md lean (around 200 lines) because every teammate loads it; move workflow-specific instructions into skills.
  - Run `/context` to see what consumes space; disable unused MCP servers.
- **What each teammate loads:** CLAUDE.md, MCP servers, skills, plus the spawn prompt. With `--setting-sources`, teammates load from the same restricted list.
- **Compaction:** `/compact`, `/clear` and `/rewind` typed while viewing a teammate act on the **lead's** conversation (and need confirmation). A subagent definition's `autoCompactWindow` (100000 to 1000000, v2.1.296+) applies to in-process teammates.
- **Prompt cache:** an in-process teammate's cache lasts five minutes by default, including on a subscription. Set `subagentPromptCacheTtl` to `"1h"` to extend it (one-hour cache writes are billed at a higher rate).
- **Measuring:** `/usage` shows session cost and token use; on subscription plans it also attributes usage to skills, subagents and plugins. The cost figure is a local estimate, not billing.

---

## 15. Shutdown, sessions and limitations

### Shutdown

```text
Ask the researcher teammate to shut down
```

The lead sends a shutdown request; the teammate may approve (exits gracefully) or reject with an explanation. Teammates finish their current request or tool call first, so shutdown can be slow. You can also press `x` on a selected teammate (in-process) to stop it. The team config directory is removed automatically when the session ends; the task directory stays on disk.

### Sessions

- `/resume` and `/rewind` do **not** restore in-process teammates. After resuming, the lead may try to message teammates that no longer exist; tell it to spawn new ones.
- Tmux sessions can outlive Claude Code. Clean up with `tmux ls` and `tmux kill-session -t <name>`.

### Limitations (from the official page)

| Limitation | Detail |
| --- | --- |
| Experimental | Known gaps in session resumption, task coordination and shutdown |
| No resume of in-process teammates | See above |
| Task status lag | Dependents can stay blocked if a task is not marked complete |
| Slow shutdown | Teammates finish the current call first |
| One team per session | No extra named teams; no cross-session teams |
| No nested teams | Teammates cannot spawn teammates |
| No background subagents from in-process teammates | A teammate's own subagents run in the foreground; a subagent with `background: true` errors; `run_in_background: true` fails or runs in the foreground |
| Lead is fixed | No promotion or transfer |
| Permissions at spawn | Inherited from the lead; no per-teammate mode at spawn |
| Split panes need tmux or iTerm2 | Not VS Code terminal, Windows Terminal or Ghostty |
| Non-interactive mode | `-p` and Agent SDK sessions do not spawn teammates |

### Version-specific behaviour (collected)

| Version | Behaviour |
| --- | --- |
| before v2.1.186 | Split-pane teammates did not receive the lead's effort level |
| v2.1.233 | `CLAUDE_CODE_ENABLE_TODO_TOOLS` |
| v2.1.234 | `teammateDefaultModel` removed |
| before v2.1.251 | `CLAUDE_CODE_SUBAGENT_MODEL` took first priority for teammate models |
| v2.1.257 | `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` |
| v2.1.268 | Current default set for Task-tool availability |
| before v2.1.281 | Split-pane teammates loaded every settings source regardless of `--setting-sources` |
| v2.1.290 | `agent_id` added to team hook input |
| v2.1.296 | `autoCompactWindow` for in-process teammates |
| v2.1.309 | Split-pane teammates inherit `--disallowedTools` and `--tools` |

---

## 16. Applying this to MedCore HMS

### Should we use a team here?

Use a team **selectively**. MedCore's Phase 0 to Phase 2 work is sequential (scaffold, schema, auth, tenancy), and the roadmap's dependency chain (P0 to P1 to P2 to P3 to P4) means a single session is usually cheaper and safer. Teams pay off once contracts are stable and modules are independent.

| Phase | Recommended approach |
| --- | --- |
| P0 scaffold, P1 auth, P2 tenancy | Single session (shared files, foundation) |
| Schema design (Day 2) | Single session; schema is the shared contract |
| P4 EMR, P5 prescriptions, P6 lab, P7 pharmacy | **Team**: one teammate per module once schema, auth and tenancy are in place |
| P8 billing | Single session or small team; payments and webhooks need careful serial reasoning |
| P11 dashboards and search | **Team**: backend analytics vs frontend dashboards |
| Security audit, PR review | **Team of reviewers** (security, tenancy isolation, performance, test coverage) |
| Hard bugs (race conditions, cross-tenant leaks) | **Team with competing hypotheses** |

### Ownership map for the monorepo

| Owner | Owns | Must not touch |
| --- | --- | --- |
| Lead | `packages/types`, `apps/api/prisma/schema.prisma` and migrations, `apps/api/src/common`, root configs, `docker/`, `.github/` | |
| api-dev (per module) | `apps/api/src/modules/<module>/` and its tests | Other modules, `prisma/`, `packages/types` |
| web-dev | `apps/web/**` | `apps/api`, `packages/types` |
| qa | `apps/api/test/`, `e2e/`, `apps/web/**/*.test.*` | Production source |
| reviewer(s) | Read-only | Everything (use a read-only `tools` list) |

Changes needed in the lead's files are requested by message; the lead makes them and notifies others. This keeps the Prisma schema, shared types and migrations single-writer, which matters because the roadmap treats schema churn as a major risk.

### Suggested project files

1. `.claude/agents/` definitions: `api-module-dev`, `web-dev`, `qa-tester`, `security-reviewer` (read-only `tools`), `tenancy-auditor` (read-only).
2. `.claude/settings.json` (committed): `permissions.allow` for safe commands such as `Bash(pnpm *)`, and the three team hooks. Keep `.claude/settings.local.json` for the personal `env` flag.
3. A CLAUDE.md section recording non-negotiables so every teammate loads them: no AI/LLM APIs, tenant scoping via the Prisma extension only, RBAC via `@Roles`, PRD response envelope, never edit applied migrations, mock providers for email, SMS, payments and storage.

### MedCore-specific hook gates

- **TaskCompleted:** run `pnpm typecheck` and the module's tests; for any task touching the data layer also run the **tenancy isolation suite** and block completion on failure (roadmap rule: a tenancy test failure stops everything).
- **TeammateIdle:** require lint and typecheck clean for the files the teammate changed.
- **TaskCreated:** require subjects of the form `[P4-EMR] ...` so tasks map to roadmap phases.
- **PreToolUse (Edit/Write):** deny writes outside the teammate's owned paths, and deny edits to existing migration files and `.env`.

### Example prompts for this project

```text
Create an agent team for Phase 4 (EMR) and Phase 6 (Lab), after Phase 3 is merged.
Teammates: emr-dev owns apps/api/src/modules/emr; lab-dev owns
apps/api/src/modules/lab; qa owns apps/api/test and e2e. Schema and shared
types are owned by the lead: request changes by message. Every task must end
with passing unit tests, an integration test, and the tenancy isolation suite.
Use Sonnet for teammates. Wait for teammates to finish before integrating.
```

```text
Spawn four reviewers for the current branch: security (auth, JWT, uploads),
tenancy (every query is hospitalId-scoped, ids by guess return 404), billing
integrity (totals, webhooks, idempotency), and test coverage. Read-only. Each
reports findings with severity, file and line.
```

### Practical cautions for a solo, low-cost setup

- Teams multiply token use; as a first-year student project on a limited plan, prefer 2 to 3 teammates and short sessions.
- Task tools are model-dependent (section 10): if your lead model is newer than Sonnet 4.6 / Opus 4.7, set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` or the team has no shared task list.
- The `device_bash` shell in some environments cannot run Docker or tmux; use in-process mode unless you run Claude Code in your own macOS terminal (tmux or iTerm2).

---

## 17. Best practices, troubleshooting and examples

### Best practices

1. **Start with research and review**, not parallel implementation, until the workflow is familiar.
2. **Give teammates enough context** in the spawn prompt (paths, constraints, stack facts, expected output format).
3. **Team size:** 3 to 5; add more only if work genuinely parallelises.
4. **Task size:** self-contained, with a clear deliverable; roughly 5 to 6 tasks per teammate.
5. **Own files, not features:** assign file or directory ownership explicitly.
6. **Wait for teammates:** if the lead starts implementing itself, tell it to wait.
7. **Monitor and steer:** check progress, redirect weak approaches, do not leave a team unattended for long.
8. **Pre-approve safe permissions** before spawning.
9. **Shut down finished teammates** to stop token use.
10. **Use hooks for non-negotiables** (tests, tenancy, file ownership) instead of relying on prompts.

### Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Teammates do not appear | In-process: look in the agent panel under the prompt, arrow keys, Enter. A row may be hidden (idle for 30 s) not stopped; message it by name. The task may not have seemed complex enough; ask explicitly for a team. Split panes: check `which tmux`; for iTerm2 confirm `it2` and the Python API |
| Claude used subagents, not a team | Ask explicitly for an "agent team"; remember subagents appear in the same panel |
| Teammates spawn when you wanted subagents | Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` to `0` (check higher-precedence settings and managed settings) |
| Too many permission prompts | Pre-approve rules in settings; for split panes use `--settings` with `permissions.allow` |
| Teammate stopped after an error | Open its transcript, give instructions, or spawn a replacement. A message wakes a teammate that is waiting to retry |
| Lead declares done early | Tell it to keep going and check the task list |
| Dependent tasks stuck | A teammate did not mark its task complete; verify and update, or nudge it |
| Resumed session cannot find teammates | In-process teammates are not restored; ask the lead to spawn new ones |
| Teammate has no definition tools after restore | The agent file's folder is not trusted; trust that exact folder |
| Orphaned tmux sessions | `tmux ls`, then `tmux kill-session -t <name>` |
| Message failed to send | Mailbox write error (disk full or directory not writable); see the official errors page |
| No shared task list | Task tools are model-dependent; set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` |
| Split-pane teammate ignored `--allowedTools` | That flag is not passed to split-pane teammates; use `--settings` |

### Official example prompts (adapted)

Parallel code review:

```text
Spawn three teammates to review PR #142:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

Competing hypotheses:

```text
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk to
each other to try to disprove each other's theories, like a scientific
debate. Update the findings doc with whatever consensus emerges.
```

Plan-before-implement (switch the lead into plan mode first):

```text
Spawn an architect teammate to refactor the authentication module.
```

Control prompts:

```text
Wait for your teammates to complete their tasks before proceeding
```

```text
Ask the researcher teammate to shut down
```

---

## 18. Gaps and unverified items

I did not invent anything to fill these:

- **`teammateMode` entry in the settings reference** and **`CLAUDE_CODE_SUBAGENT_MODEL` / `_FORCE` env-var entries**: the retrieved excerpts did not contain them. Their behaviour above comes from the agent-teams page.
- **`cleanupPeriodDays` default:** a costs-page passage mentions 30 days by default for usage reports; confirm in the settings reference.
- **A command or setting to list team status or members** was not found.
- **Exact interaction of `continueOnBlock` with exit code 2** for `TeammateIdle` and `TaskCompleted` was only seen as a summary line.
- **Whether a subagent definition's `permissionMode` or `hooks` frontmatter applies to a teammate** is not stated on the pages accessed.
- **Worktree interaction with teams** (`isolation: worktree`, `--worktree`) is not described on the agent-teams page.
- **Cross-session messaging** and **`/rate-limit-options`** style behaviours were not reviewed in depth.
- The agent-teams page states teammate count has **no hard limit**; no maximum is documented.
- The `--teammate-mode` flag is described as absent from `claude --help` on one page and listed on the CLI reference page. Treat the flag as working but unadvertised.

---

## 19. Sources and how to re-verify

Primary source:

- Agent teams: https://code.claude.com/docs/en/agent-teams

Supporting pages used:

- Subagents: https://code.claude.com/docs/en/sub-agents
- Hooks (TeammateIdle, TaskCreated, TaskCompleted): https://code.claude.com/docs/en/hooks
- Tools reference (Task tool availability, SendMessage, TaskStop): https://code.claude.com/docs/en/tools-reference
- Model configuration (effort, `availableModels`): https://code.claude.com/docs/en/model-config
- Settings reference: https://code.claude.com/docs/en/settings-reference
- Environment variables: https://code.claude.com/docs/en/env-vars
- CLI reference: https://code.claude.com/docs/en/cli-reference
- Costs (agent team token costs): https://code.claude.com/docs/en/costs
- Documentation index: https://code.claude.com/docs/llms.txt

**Re-verification routine (every few weeks while the feature is experimental):**

1. Run `claude --version` and compare with the version table in section 15.
2. Re-read the agent-teams page's Limitations section.
3. Check the hooks page for changes to `TeammateIdle`, `TaskCreated`, `TaskCompleted`.
4. Check the tools reference for Task tool availability by model.
5. Update this file and note the date at the top.
