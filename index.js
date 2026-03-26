const { Skill } = require('king-louie/skill-interface');
const { execFile } = require('child_process');

function ok(message, format = 'markdown') {
  return { ok: true, message, format };
}

function fail(error) {
  return { ok: false, error: String(error) };
}

class GitHubSkill extends Skill {
  getMetadata() {
    return {
      id: 'gh',
      name: 'GitHub',
      version: '1.0.0',
      description: 'Manage GitHub repositories, issues, pull requests, and actions from chat',
      author: 'banana-skills',
      commands: ['gh'],
      resolvers: ['code', 'cli'],
      systemDependencies: [
        {
          command: 'gh',
          name: 'GitHub CLI',
          required: true,
          installUrl: 'https://cli.github.com/',
          install: {
            win: 'winget install --id GitHub.cli',
            mac: 'brew install gh',
            linux: 'sudo apt install gh || sudo dnf install gh'
          }
        },
        {
          command: 'git',
          name: 'Git',
          required: true,
          installUrl: 'https://git-scm.com/downloads',
          install: {
            win: 'winget install --id Git.Git',
            mac: 'brew install git',
            linux: 'sudo apt install git'
          }
        }
      ]
    };
  }

  async initialize(context) {
    this.context = context;
    this.cwd = context.workingDirectory;
  }

  _gh(args) {
    const cwd = this.cwd;
    return new Promise((resolve, reject) => {
      execFile('gh', args, { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
        if (err) {
          const msg = stderr.trim() || stdout.trim() || err.message;
          return reject(new Error(msg));
        }
        resolve(stdout.trim());
      });
    });
  }

  async resolveCode({ args }) {
    if (!args.length) return this._help();
    if (args[0] === 'help') return this._help();
    return null;
  }

  async resolveCli({ command, args, context }) {
    if (!args.length) return null;

    const [resource, action, ...rest] = args;

    try {
      switch (resource) {
        case 'status':   return await this._status();
        case 'pr':       return await this._pr(action, rest);
        case 'issue':    return await this._issue(action, rest);
        case 'run':      return await this._run(action, rest);
        case 'repo':     return await this._repo(action);
        case 'search':   return await this._search([action, ...rest].filter(Boolean));
        default:
          return fail(`Unknown resource: ${resource}. Run \`/gh help\` for usage.`);
      }
    } catch (err) {
      return fail(err.message);
    }
  }

  async handleCommand(command, args, context) {
    return this.resolveCli({ command, args, context });
  }

  // --- status ---

  async _status() {
    const auth = await this._gh(['auth', 'status']);
    let repoInfo = '';
    try {
      const repo = await this._gh(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef', '--jq', '"\(.nameWithOwner) (default: \(.defaultBranchRef.name))"']);
      repoInfo = `\n**Repo:** ${repo}`;
    } catch (_) {
      repoInfo = '\n**Repo:** not inside a GitHub repo';
    }
    return ok(`\`\`\`\n${auth}\n\`\`\`${repoInfo}`);
  }

  // --- pull requests ---

  async _pr(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['pr', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No open pull requests.');
      }
      case 'view': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr view <number>`');
        const out = await this._gh(['pr', 'view', num]);
        return ok(`\`\`\`\n${out}\n\`\`\``);
      }
      case 'create': {
        const title = rest.join(' ');
        if (!title) return fail('Usage: `/gh pr create <title>`');
        const out = await this._gh(['pr', 'create', '--title', title, '--fill']);
        return ok(out);
      }
      case 'merge': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr merge <number>`');
        const out = await this._gh(['pr', 'merge', num, '--merge']);
        return ok(out || `PR #${num} merged.`);
      }
      case 'review': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr review <number>`');
        const diff = await this._gh(['pr', 'diff', num]);
        const prInfo = await this._gh(['pr', 'view', num, '--json', 'title,body,url', '--jq', '"\(.title)\n\(.url)\n\n\(.body)"']);
        return {
          ok: true,
          message: `## PR Review: ${prInfo.split('\n')[0]}\n\n${prInfo.split('\n')[1]}\n\nPlease review the following diff and provide feedback on code quality, bugs, style, and suggestions:\n\n\`\`\`diff\n${diff}\n\`\`\``,
          format: 'markdown',
          continueWithAgent: true
        };
      }
      default:
        return fail(`Unknown PR action: ${action}. Available: list, view, create, merge, review`);
    }
  }

  // --- issues ---

  async _issue(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['issue', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No open issues.');
      }
      case 'view': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue view <number>`');
        const out = await this._gh(['issue', 'view', num]);
        return ok(`\`\`\`\n${out}\n\`\`\``);
      }
      case 'create': {
        const title = rest.join(' ');
        if (!title) return fail('Usage: `/gh issue create <title>`');
        const out = await this._gh(['issue', 'create', '--title', title, '--body', '']);
        return ok(out);
      }
      default:
        return fail(`Unknown issue action: ${action}. Available: list, view, create`);
    }
  }

  // --- workflow runs ---

  async _run(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['run', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No recent workflow runs.');
      }
      case 'view': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh run view <id>`');
        const out = await this._gh(['run', 'view', id]);
        return ok(`\`\`\`\n${out}\n\`\`\``);
      }
      case 'watch': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh run watch <id>`');
        const out = await this._gh(['run', 'watch', id]);
        return ok(`\`\`\`\n${out}\n\`\`\``);
      }
      default:
        return fail(`Unknown run action: ${action}. Available: list, view, watch`);
    }
  }

  // --- repo ---

  async _repo(action) {
    if (action && action !== 'view') {
      return fail(`Unknown repo action: ${action}. Available: view`);
    }
    const out = await this._gh(['repo', 'view']);
    return ok(`\`\`\`\n${out}\n\`\`\``);
  }

  // --- search ---

  async _search(terms) {
    if (!terms.length) return fail('Usage: `/gh search <query>`');
    const query = terms.join(' ');
    const issues = await this._gh(['search', 'issues', query, '--limit', '10']);
    const prs = await this._gh(['search', 'prs', query, '--limit', '10']);

    let msg = '';
    if (issues) msg += `### Issues\n\`\`\`\n${issues}\n\`\`\`\n\n`;
    if (prs) msg += `### Pull Requests\n\`\`\`\n${prs}\n\`\`\``;
    return ok(msg || 'No results found.');
  }

  // --- help ---

  _help() {
    return ok(`# GitHub Skill

| Command | Description |
|---------|-------------|
| \`/gh status\` | Show auth status and current repo context |
| \`/gh pr list\` | List open pull requests |
| \`/gh pr view <number>\` | View PR details, checks, and review status |
| \`/gh pr create <title>\` | Create a PR from the current branch |
| \`/gh pr merge <number>\` | Merge a pull request |
| \`/gh pr review <number>\` | AI-assisted code review of a PR's diff |
| \`/gh issue list\` | List open issues |
| \`/gh issue view <number>\` | View issue details and comments |
| \`/gh issue create <title>\` | Create a new issue |
| \`/gh run list\` | List recent workflow runs |
| \`/gh run view <id>\` | View workflow run details and logs |
| \`/gh run watch <id>\` | Stream workflow run logs until completion |
| \`/gh repo view\` | Show current repo info |
| \`/gh search <query>\` | Search issues/PRs across repos |`);
  }

  async getHelp() {
    return this._help().message;
  }

  async cleanup() {}
}

module.exports = GitHubSkill;
