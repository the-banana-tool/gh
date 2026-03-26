# gh - GitHub Skill

Manage GitHub repositories, issues, pull requests, and actions from chat.

## Requirements

This skill requires the following tools to be installed on your system:

| Dependency | Required | Install |
|------------|----------|---------|
| [GitHub CLI (`gh`)](https://cli.github.com/) | Yes | `winget install --id GitHub.cli` (Win) / `brew install gh` (Mac) / `sudo apt install gh` (Linux) |
| [Git](https://git-scm.com/downloads) | Yes | `winget install --id Git.Git` (Win) / `brew install git` (Mac) / `sudo apt install git` (Linux) |

After installing, authenticate the GitHub CLI:

```bash
gh auth login
```

If a required dependency is missing, the skill will load but commands will return an error with install instructions for your platform.

## Commands

| Command | Description |
|---------|-------------|
| `/gh status` | Show auth status and current repo context |
| `/gh pr list` | List open pull requests |
| `/gh pr view <number>` | View PR details, checks, and review status |
| `/gh pr create <title>` | Create a PR from the current branch |
| `/gh pr merge <number>` | Merge a pull request |
| `/gh pr review <number>` | AI-assisted code review of a PR's diff |
| `/gh issue list` | List open issues |
| `/gh issue view <number>` | View issue details and comments |
| `/gh issue create <title>` | Create a new issue |
| `/gh run list` | List recent workflow runs |
| `/gh run view <id>` | View workflow run details and logs |
| `/gh run watch <id>` | Stream workflow run logs until completion |
| `/gh repo view` | Show current repo info |
| `/gh search <query>` | Search issues/PRs across repos |

## Extra arguments

Most list commands pass extra arguments through to `gh` directly:

```
/gh pr list --state closed
/gh issue list --label bug
/gh run list --limit 5
```

## AI-assisted PR review

`/gh pr review <number>` fetches the PR diff and metadata, then hands them to the active agent for code review. The agent analyzes code quality, bugs, style, and provides suggestions.

## Installation

```bash
# From GitHub
king-louie skill:install https://github.com/the-banana-tool/gh

# From local directory
king-louie skill:install E:\Programming\banana-skills\gh
```

## Development

```bash
# Run tests
node --test index.test.js
```
