const { Skill } = require('king-louie/skill-interface');
const { execFile } = require('child_process');

function ok(message, format = 'markdown') {
  return { ok: true, message, format };
}

function fail(error) {
  return { ok: false, error: String(error) };
}

function wrap(out) {
  return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No output.');
}

class GitHubSkill extends Skill {
  getMetadata() {
    return {
      id: 'gh',
      name: 'GitHub',
      version: '26.3.25',
      description: 'Full GitHub CLI wrapper — repos, PRs, issues, releases, secrets, labels, gists, orgs, projects, and more',
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

  _git(args) {
    const cwd = this.cwd;
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, timeout: 10_000 }, (err, stdout) => {
        if (err) return reject(err);
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
    const normalized = resource.replace(/^\//, '').toLowerCase();

    try {
      switch (normalized) {
        case 'help':      return this._help();
        case 'status':    return await this._status();
        case 'pr':        return await this._pr(action, rest);
        case 'issue':     return await this._issue(action, rest);
        case 'run':       return await this._run(action, rest);
        case 'workflow':  return await this._workflow(action, rest);
        case 'repo':      return await this._repo(action, rest);
        case 'release':   return await this._release(action, rest);
        case 'gist':      return await this._gist(action, rest);
        case 'label':     return await this._label(action, rest);
        case 'secret':    return await this._secret(action, rest);
        case 'variable':  return await this._variable(action, rest);
        case 'cache':     return await this._cache(action, rest);
        case 'auth':      return await this._auth(action, rest);
        case 'org':       return await this._org(action, rest);
        case 'project':   return await this._project(action, rest);
        case 'ruleset':   return await this._ruleset(action, rest);
        case 'ssh-key':   return await this._sshKey(action, rest);
        case 'gpg-key':   return await this._gpgKey(action, rest);
        case 'codespace': return await this._codespace(action, rest);
        case 'api':       return await this._api([action, ...rest].filter(Boolean));
        case 'search':    return await this._search([action, ...rest].filter(Boolean));
        case 'browse':    return await this._browse([action, ...rest].filter(Boolean));
        default:
          // Passthrough: run any unrecognized gh subcommand directly
          return await this._passthrough([normalized, action, ...rest].filter(Boolean));
      }
    } catch (err) {
      return fail(err.message);
    }
  }

  async handleCommand(command, args, context) {
    let parsedArgs = Array.isArray(args) ? args : [];
    if (parsedArgs.length === 1 && parsedArgs[0].includes(' ')) {
      parsedArgs = parsedArgs[0].trim().split(/\s+/);
    }

    const result = await this.resolveCli({ command, args: parsedArgs, context });
    return result || this._help();
  }

  // ── passthrough ──────────────────────────────────────────

  async _passthrough(args) {
    if (!args.length) return this._help();
    const out = await this._gh(args);
    return wrap(out);
  }

  // ── status ───────────────────────────────────────────────

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

  // ── pull requests ────────────────────────────────────────

  async _pr(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['pr', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No open pull requests.');
      }
      case 'view': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr view <number>`');
        const out = await this._gh(['pr', 'view', num, ...rest.slice(1)]);
        return wrap(out);
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
        const out = await this._gh(['pr', 'merge', num, '--merge', ...rest.slice(1)]);
        return ok(out || `PR #${num} merged.`);
      }
      case 'close': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr close <number>`');
        const out = await this._gh(['pr', 'close', num, ...rest.slice(1)]);
        return ok(out || `PR #${num} closed.`);
      }
      case 'reopen': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr reopen <number>`');
        const out = await this._gh(['pr', 'reopen', num]);
        return ok(out || `PR #${num} reopened.`);
      }
      case 'checkout': case 'co': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr checkout <number>`');
        const out = await this._gh(['pr', 'checkout', num, ...rest.slice(1)]);
        return ok(out || `Checked out PR #${num}.`);
      }
      case 'diff': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr diff <number>`');
        const out = await this._gh(['pr', 'diff', num, ...rest.slice(1)]);
        return ok(out ? `\`\`\`diff\n${out}\n\`\`\`` : 'No diff.');
      }
      case 'ready': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr ready <number>`');
        const out = await this._gh(['pr', 'ready', num]);
        return ok(out || `PR #${num} marked as ready for review.`);
      }
      case 'comment': {
        const num = rest[0];
        const body = rest.slice(1).join(' ');
        if (!num || !body) return fail('Usage: `/gh pr comment <number> <body>`');
        const out = await this._gh(['pr', 'comment', num, '--body', body]);
        return ok(out || `Comment added to PR #${num}.`);
      }
      case 'edit': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr edit <number> [--title "..."] [--body "..."] [--add-label ...]`');
        const out = await this._gh(['pr', 'edit', num, ...rest.slice(1)]);
        return ok(out || `PR #${num} updated.`);
      }
      case 'checks': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh pr checks <number>`');
        const out = await this._gh(['pr', 'checks', num, ...rest.slice(1)]);
        return wrap(out);
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
        return fail(`Unknown PR action: ${action}. Available: list, view, create, merge, close, reopen, checkout, diff, ready, comment, edit, checks, review`);
    }
  }

  // ── issues ───────────────────────────────────────────────

  async _issue(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['issue', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No open issues.');
      }
      case 'view': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue view <number>`');
        const out = await this._gh(['issue', 'view', num, ...rest.slice(1)]);
        return wrap(out);
      }
      case 'create': {
        const title = rest.join(' ');
        if (!title) return fail('Usage: `/gh issue create <title>`');
        const out = await this._gh(['issue', 'create', '--title', title, '--body', '']);
        return ok(out);
      }
      case 'close': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue close <number>`');
        const out = await this._gh(['issue', 'close', num, ...rest.slice(1)]);
        return ok(out || `Issue #${num} closed.`);
      }
      case 'reopen': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue reopen <number>`');
        const out = await this._gh(['issue', 'reopen', num]);
        return ok(out || `Issue #${num} reopened.`);
      }
      case 'comment': {
        const num = rest[0];
        const body = rest.slice(1).join(' ');
        if (!num || !body) return fail('Usage: `/gh issue comment <number> <body>`');
        const out = await this._gh(['issue', 'comment', num, '--body', body]);
        return ok(out || `Comment added to issue #${num}.`);
      }
      case 'edit': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue edit <number> [--title "..."] [--body "..."] [--add-label ...]`');
        const out = await this._gh(['issue', 'edit', num, ...rest.slice(1)]);
        return ok(out || `Issue #${num} updated.`);
      }
      case 'transfer': {
        const num = rest[0];
        const dest = rest[1];
        if (!num || !dest) return fail('Usage: `/gh issue transfer <number> <destination-repo>`');
        const out = await this._gh(['issue', 'transfer', num, dest]);
        return ok(out || `Issue #${num} transferred to ${dest}.`);
      }
      case 'pin': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue pin <number>`');
        const out = await this._gh(['issue', 'pin', num]);
        return ok(out || `Issue #${num} pinned.`);
      }
      case 'unpin': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue unpin <number>`');
        const out = await this._gh(['issue', 'unpin', num]);
        return ok(out || `Issue #${num} unpinned.`);
      }
      case 'lock': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue lock <number> [--reason ...]`');
        const out = await this._gh(['issue', 'lock', num, ...rest.slice(1)]);
        return ok(out || `Issue #${num} locked.`);
      }
      case 'unlock': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue unlock <number>`');
        const out = await this._gh(['issue', 'unlock', num]);
        return ok(out || `Issue #${num} unlocked.`);
      }
      case 'delete': {
        const num = rest[0];
        if (!num) return fail('Usage: `/gh issue delete <number>`');
        const out = await this._gh(['issue', 'delete', num, '--yes']);
        return ok(out || `Issue #${num} deleted.`);
      }
      default:
        return fail(`Unknown issue action: ${action}. Available: list, view, create, close, reopen, comment, edit, transfer, pin, unpin, lock, unlock, delete`);
    }
  }

  // ── workflow runs ────────────────────────────────────────

  async _run(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['run', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No recent workflow runs.');
      }
      case 'view': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh run view <id>`');
        const out = await this._gh(['run', 'view', id, ...rest.slice(1)]);
        return wrap(out);
      }
      case 'watch': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh run watch <id>`');
        const out = await this._gh(['run', 'watch', id, ...rest.slice(1)]);
        return wrap(out);
      }
      case 'rerun': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh run rerun <id> [--failed]`');
        const out = await this._gh(['run', 'rerun', id, ...rest.slice(1)]);
        return ok(out || `Run ${id} re-triggered.`);
      }
      case 'cancel': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh run cancel <id>`');
        const out = await this._gh(['run', 'cancel', id]);
        return ok(out || `Run ${id} cancelled.`);
      }
      case 'download': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh run download <id> [--dir <path>]`');
        const out = await this._gh(['run', 'download', id, ...rest.slice(1)]);
        return ok(out || `Artifacts from run ${id} downloaded.`);
      }
      case 'delete': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh run delete <id>`');
        const out = await this._gh(['run', 'delete', id]);
        return ok(out || `Run ${id} deleted.`);
      }
      default:
        return fail(`Unknown run action: ${action}. Available: list, view, watch, rerun, cancel, download, delete`);
    }
  }

  // ── workflows ────────────────────────────────────────────

  async _workflow(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['workflow', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No workflows found.');
      }
      case 'view': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh workflow view <id|name>`');
        const out = await this._gh(['workflow', 'view', id, ...rest.slice(1)]);
        return wrap(out);
      }
      case 'run': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh workflow run <id|name> [--ref <branch>]`');
        const out = await this._gh(['workflow', 'run', id, ...rest.slice(1)]);
        return ok(out || `Workflow ${id} triggered.`);
      }
      case 'enable': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh workflow enable <id|name>`');
        const out = await this._gh(['workflow', 'enable', id]);
        return ok(out || `Workflow ${id} enabled.`);
      }
      case 'disable': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh workflow disable <id|name>`');
        const out = await this._gh(['workflow', 'disable', id]);
        return ok(out || `Workflow ${id} disabled.`);
      }
      default:
        return fail(`Unknown workflow action: ${action}. Available: list, view, run, enable, disable`);
    }
  }

  // ── repo ─────────────────────────────────────────────────

  async _repo(action, rest = []) {
    switch (action) {
      case undefined:
      case 'view': {
        const name = rest[0];
        const args = ['repo', 'view'];
        if (name) args.push(name);
        args.push(...rest.slice(name ? 1 : 0));
        const out = await this._gh(args);
        return wrap(out);
      }
      case 'create': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh repo create <name> [--public|--private] [--description "<desc>"]`');
        const flags = rest.slice(1);
        if (!flags.some(f => f === '--public' || f === '--private' || f === '--internal')) {
          flags.push('--private');
        }
        const out = await this._gh(['repo', 'create', name, ...flags]);
        return ok(out);
      }
      case 'link': {
        let remoteName = 'origin';
        const remoteIdx = rest.indexOf('--remote');
        if (remoteIdx !== -1 && rest[remoteIdx + 1]) {
          remoteName = rest[remoteIdx + 1];
        }
        const target = rest.find(r => r !== '--remote' && r !== remoteName);
        if (!target) return fail('Usage: `/gh repo link <owner/repo> [--remote <name>]`');

        let existingUrl = '';
        try {
          existingUrl = await this._git(['remote', 'get-url', remoteName]);
        } catch (_) { /* remote doesn't exist yet */ }

        if (existingUrl) {
          return fail(`Remote "${remoteName}" already exists → ${existingUrl}. Use \`/gh repo link ${target} --remote <other-name>\` or remove the existing remote first.`);
        }

        const url = `https://github.com/${target}.git`;
        await this._git(['remote', 'add', remoteName, url]);
        return ok(`Linked remote **${remoteName}** → \`${url}\``);
      }
      case 'init': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh repo init <name> [--public|--private]`');
        const flags = rest.slice(1);
        if (!flags.some(f => f === '--public' || f === '--private' || f === '--internal')) {
          flags.push('--private');
        }
        const out = await this._gh(['repo', 'create', name, '--source=.', ...flags]);
        return ok(out);
      }
      case 'list': {
        const flags = rest.length ? rest : ['--limit', '20'];
        const out = await this._gh(['repo', 'list', ...flags]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No repositories found.');
      }
      case 'clone': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh repo clone <owner/repo> [-- <dir>]`');
        const out = await this._gh(['repo', 'clone', name, ...rest.slice(1)]);
        return ok(out || `Cloned ${name}.`);
      }
      case 'fork': {
        const name = rest[0];
        const flags = rest.slice(name && !name.startsWith('-') ? 1 : 0);
        const args = ['repo', 'fork'];
        if (name && !name.startsWith('-')) args.push(name);
        args.push(...flags);
        const out = await this._gh(args);
        return ok(out || 'Forked.');
      }
      case 'edit': {
        const out = await this._gh(['repo', 'edit', ...rest]);
        return ok(out || 'Repository updated.');
      }
      case 'delete': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh repo delete <owner/repo> --yes`');
        const out = await this._gh(['repo', 'delete', name, '--yes', ...rest.slice(1)]);
        return ok(out || `Repository ${name} deleted.`);
      }
      case 'archive': {
        const name = rest[0];
        const args = ['repo', 'archive', '--yes'];
        if (name) args.splice(2, 0, name);
        const out = await this._gh(args);
        return ok(out || 'Repository archived.');
      }
      case 'unarchive': {
        const name = rest[0];
        const args = ['repo', 'unarchive', '--yes'];
        if (name) args.splice(2, 0, name);
        const out = await this._gh(args);
        return ok(out || 'Repository unarchived.');
      }
      case 'rename': {
        const newName = rest[0];
        if (!newName) return fail('Usage: `/gh repo rename <new-name>`');
        const out = await this._gh(['repo', 'rename', newName, '--yes', ...rest.slice(1)]);
        return ok(out || `Repository renamed to ${newName}.`);
      }
      case 'sync': {
        const out = await this._gh(['repo', 'sync', ...rest]);
        return ok(out || 'Repository synced.');
      }
      case 'deploy-key': {
        if (!rest.length) return fail('Usage: `/gh repo deploy-key list|add|delete`');
        const out = await this._gh(['repo', 'deploy-key', ...rest]);
        return wrap(out);
      }
      case 'autolink': {
        if (!rest.length) return fail('Usage: `/gh repo autolink list|create|view|delete`');
        const out = await this._gh(['repo', 'autolink', ...rest]);
        return wrap(out);
      }
      default:
        return fail(`Unknown repo action: ${action}. Available: view, create, link, init, list, clone, fork, edit, delete, archive, unarchive, rename, sync, deploy-key, autolink`);
    }
  }

  // ── releases ─────────────────────────────────────────────

  async _release(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['release', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No releases found.');
      }
      case 'view': {
        const tag = rest[0];
        if (!tag) return fail('Usage: `/gh release view <tag>`');
        const out = await this._gh(['release', 'view', tag, ...rest.slice(1)]);
        return wrap(out);
      }
      case 'create': {
        const tag = rest[0];
        if (!tag) return fail('Usage: `/gh release create <tag> [--title "..."] [--notes "..."] [--draft] [--prerelease]`');
        const out = await this._gh(['release', 'create', tag, ...rest.slice(1)]);
        return ok(out);
      }
      case 'edit': {
        const tag = rest[0];
        if (!tag) return fail('Usage: `/gh release edit <tag> [--title "..."] [--notes "..."]`');
        const out = await this._gh(['release', 'edit', tag, ...rest.slice(1)]);
        return ok(out || `Release ${tag} updated.`);
      }
      case 'delete': {
        const tag = rest[0];
        if (!tag) return fail('Usage: `/gh release delete <tag> [--yes]`');
        const out = await this._gh(['release', 'delete', tag, '--yes', ...rest.slice(1)]);
        return ok(out || `Release ${tag} deleted.`);
      }
      case 'upload': {
        const tag = rest[0];
        const files = rest.slice(1);
        if (!tag || !files.length) return fail('Usage: `/gh release upload <tag> <file>...`');
        const out = await this._gh(['release', 'upload', tag, ...files]);
        return ok(out || `Assets uploaded to release ${tag}.`);
      }
      case 'download': {
        const tag = rest[0];
        if (!tag) return fail('Usage: `/gh release download <tag> [--dir <path>] [--pattern <glob>]`');
        const out = await this._gh(['release', 'download', tag, ...rest.slice(1)]);
        return ok(out || `Assets from release ${tag} downloaded.`);
      }
      default:
        return fail(`Unknown release action: ${action}. Available: list, view, create, edit, delete, upload, download`);
    }
  }

  // ── gists ────────────────────────────────────────────────

  async _gist(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['gist', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No gists found.');
      }
      case 'view': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh gist view <id|url>`');
        const out = await this._gh(['gist', 'view', id, ...rest.slice(1)]);
        return wrap(out);
      }
      case 'create': {
        if (!rest.length) return fail('Usage: `/gh gist create <file>... [--public] [--desc "..."]`');
        const out = await this._gh(['gist', 'create', ...rest]);
        return ok(out);
      }
      case 'edit': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh gist edit <id> [--add <file>] [--remove <file>]`');
        const out = await this._gh(['gist', 'edit', id, ...rest.slice(1)]);
        return ok(out || `Gist ${id} updated.`);
      }
      case 'delete': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh gist delete <id>`');
        const out = await this._gh(['gist', 'delete', id]);
        return ok(out || `Gist ${id} deleted.`);
      }
      case 'clone': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh gist clone <id> [<dir>]`');
        const out = await this._gh(['gist', 'clone', id, ...rest.slice(1)]);
        return ok(out || `Gist ${id} cloned.`);
      }
      case 'rename': {
        const id = rest[0];
        const oldName = rest[1];
        const newName = rest[2];
        if (!id || !oldName || !newName) return fail('Usage: `/gh gist rename <id> <old-name> <new-name>`');
        const out = await this._gh(['gist', 'rename', id, oldName, newName]);
        return ok(out || `Gist file renamed.`);
      }
      default:
        return fail(`Unknown gist action: ${action}. Available: list, view, create, edit, delete, clone, rename`);
    }
  }

  // ── labels ───────────────────────────────────────────────

  async _label(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['label', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No labels found.');
      }
      case 'create': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh label create <name> [--color <hex>] [--description "..."]`');
        const out = await this._gh(['label', 'create', name, ...rest.slice(1)]);
        return ok(out || `Label "${name}" created.`);
      }
      case 'edit': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh label edit <name> [--name <new>] [--color <hex>] [--description "..."]`');
        const out = await this._gh(['label', 'edit', name, ...rest.slice(1)]);
        return ok(out || `Label "${name}" updated.`);
      }
      case 'delete': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh label delete <name> --yes`');
        const out = await this._gh(['label', 'delete', name, '--yes', ...rest.slice(1)]);
        return ok(out || `Label "${name}" deleted.`);
      }
      case 'clone': {
        const source = rest[0];
        if (!source) return fail('Usage: `/gh label clone <source-repo>`');
        const out = await this._gh(['label', 'clone', source, ...rest.slice(1)]);
        return ok(out || `Labels cloned from ${source}.`);
      }
      default:
        return fail(`Unknown label action: ${action}. Available: list, create, edit, delete, clone`);
    }
  }

  // ── secrets ──────────────────────────────────────────────

  async _secret(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['secret', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No secrets found.');
      }
      case 'set': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh secret set <name> [--body <value>] [--env <env>] [--org <org>]`');
        const out = await this._gh(['secret', 'set', name, ...rest.slice(1)]);
        return ok(out || `Secret "${name}" set.`);
      }
      case 'delete': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh secret delete <name> [--env <env>] [--org <org>]`');
        const out = await this._gh(['secret', 'delete', name, ...rest.slice(1)]);
        return ok(out || `Secret "${name}" deleted.`);
      }
      default:
        return fail(`Unknown secret action: ${action}. Available: list, set, delete`);
    }
  }

  // ── variables ────────────────────────────────────────────

  async _variable(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['variable', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No variables found.');
      }
      case 'get': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh variable get <name>`');
        const out = await this._gh(['variable', 'get', name, ...rest.slice(1)]);
        return wrap(out);
      }
      case 'set': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh variable set <name> [--body <value>] [--env <env>] [--org <org>]`');
        const out = await this._gh(['variable', 'set', name, ...rest.slice(1)]);
        return ok(out || `Variable "${name}" set.`);
      }
      case 'delete': {
        const name = rest[0];
        if (!name) return fail('Usage: `/gh variable delete <name> [--env <env>] [--org <org>]`');
        const out = await this._gh(['variable', 'delete', name, ...rest.slice(1)]);
        return ok(out || `Variable "${name}" deleted.`);
      }
      default:
        return fail(`Unknown variable action: ${action}. Available: list, get, set, delete`);
    }
  }

  // ── cache ────────────────────────────────────────────────

  async _cache(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['cache', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No caches found.');
      }
      case 'delete': {
        const key = rest[0];
        if (!key) return fail('Usage: `/gh cache delete <key|--all>`');
        const out = await this._gh(['cache', 'delete', key, ...rest.slice(1)]);
        return ok(out || `Cache deleted.`);
      }
      default:
        return fail(`Unknown cache action: ${action}. Available: list, delete`);
    }
  }

  // ── auth ─────────────────────────────────────────────────

  async _auth(action, rest) {
    switch (action) {
      case 'status': {
        const out = await this._gh(['auth', 'status', ...rest]);
        return wrap(out);
      }
      case 'token': {
        const out = await this._gh(['auth', 'token', ...rest]);
        return ok(`Token: \`${out}\``);
      }
      case 'login': {
        const out = await this._gh(['auth', 'login', ...rest]);
        return ok(out || 'Login initiated.');
      }
      case 'logout': {
        const out = await this._gh(['auth', 'logout', ...rest]);
        return ok(out || 'Logged out.');
      }
      case 'refresh': {
        const out = await this._gh(['auth', 'refresh', ...rest]);
        return ok(out || 'Auth refreshed.');
      }
      case 'switch': {
        const out = await this._gh(['auth', 'switch', ...rest]);
        return ok(out || 'Account switched.');
      }
      case 'setup-git': {
        const out = await this._gh(['auth', 'setup-git', ...rest]);
        return ok(out || 'Git credential helper configured for gh.');
      }
      default:
        return fail(`Unknown auth action: ${action}. Available: status, token, login, logout, refresh, switch, setup-git`);
    }
  }

  // ── orgs ─────────────────────────────────────────────────

  async _org(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['org', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No organizations found.');
      }
      default: {
        // gh org has limited subcommands — passthrough for any future additions
        const args = ['org', action, ...rest].filter(Boolean);
        const out = await this._gh(args);
        return wrap(out);
      }
    }
  }

  // ── projects ─────────────────────────────────────────────

  async _project(action, rest) {
    const valid = [
      'list', 'view', 'create', 'edit', 'close', 'delete', 'copy',
      'field-list', 'field-create', 'field-delete',
      'item-list', 'item-create', 'item-edit', 'item-delete', 'item-archive',
      'mark-template', 'link', 'unlink'
    ];

    if (!action || !valid.includes(action)) {
      return fail(`Usage: \`/gh project <action>\`. Available: ${valid.join(', ')}`);
    }

    const out = await this._gh(['project', action, ...rest]);
    return wrap(out);
  }

  // ── rulesets ─────────────────────────────────────────────

  async _ruleset(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['ruleset', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No rulesets found.');
      }
      case 'view': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh ruleset view <id>`');
        const out = await this._gh(['ruleset', 'view', id, ...rest.slice(1)]);
        return wrap(out);
      }
      case 'check': {
        const out = await this._gh(['ruleset', 'check', ...rest]);
        return wrap(out);
      }
      default:
        return fail(`Unknown ruleset action: ${action}. Available: list, view, check`);
    }
  }

  // ── ssh-key ──────────────────────────────────────────────

  async _sshKey(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['ssh-key', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No SSH keys found.');
      }
      case 'add': {
        const file = rest[0];
        if (!file) return fail('Usage: `/gh ssh-key add <key-file> [--title "..."]`');
        const out = await this._gh(['ssh-key', 'add', file, ...rest.slice(1)]);
        return ok(out || 'SSH key added.');
      }
      case 'delete': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh ssh-key delete <id> --yes`');
        const out = await this._gh(['ssh-key', 'delete', id, '--yes', ...rest.slice(1)]);
        return ok(out || `SSH key ${id} deleted.`);
      }
      default:
        return fail(`Unknown ssh-key action: ${action}. Available: list, add, delete`);
    }
  }

  // ── gpg-key ──────────────────────────────────────────────

  async _gpgKey(action, rest) {
    switch (action) {
      case 'list': {
        const out = await this._gh(['gpg-key', 'list', ...rest]);
        return ok(out ? `\`\`\`\n${out}\n\`\`\`` : 'No GPG keys found.');
      }
      case 'add': {
        const file = rest[0];
        if (!file) return fail('Usage: `/gh gpg-key add <key-file>`');
        const out = await this._gh(['gpg-key', 'add', file]);
        return ok(out || 'GPG key added.');
      }
      case 'delete': {
        const id = rest[0];
        if (!id) return fail('Usage: `/gh gpg-key delete <id> --yes`');
        const out = await this._gh(['gpg-key', 'delete', id, '--yes']);
        return ok(out || `GPG key ${id} deleted.`);
      }
      default:
        return fail(`Unknown gpg-key action: ${action}. Available: list, add, delete`);
    }
  }

  // ── codespace ────────────────────────────────────────────

  async _codespace(action, rest) {
    const valid = [
      'list', 'view', 'create', 'delete', 'stop', 'edit', 'rebuild',
      'ssh', 'code', 'ports', 'logs', 'cp', 'jupyter'
    ];

    if (!action || !valid.includes(action)) {
      return fail(`Usage: \`/gh codespace <action>\`. Available: ${valid.join(', ')}`);
    }

    const out = await this._gh(['codespace', action, ...rest]);
    return wrap(out);
  }

  // ── api ──────────────────────────────────────────────────

  async _api(args) {
    if (!args.length) return fail('Usage: `/gh api <endpoint> [--method GET|POST|...] [--field key=value]`');
    const out = await this._gh(['api', ...args]);
    // Try to detect JSON and format it
    if (out.startsWith('{') || out.startsWith('[')) {
      return ok(`\`\`\`json\n${out}\n\`\`\``);
    }
    return wrap(out);
  }

  // ── search ───────────────────────────────────────────────

  async _search(terms) {
    if (!terms.length) return fail('Usage: `/gh search <type> <query>` — types: repos, issues, prs, commits, code');

    const type = terms[0];
    const validTypes = ['repos', 'issues', 'prs', 'commits', 'code'];

    if (validTypes.includes(type)) {
      const query = terms.slice(1);
      if (!query.length) return fail(`Usage: \`/gh search ${type} <query>\``);
      const out = await this._gh(['search', type, ...query, '--limit', '10']);
      return ok(out ? `### Search: ${type}\n\`\`\`\n${out}\n\`\`\`` : 'No results found.');
    }

    // Legacy behavior: search issues + PRs with full query
    const query = terms.join(' ');
    const issues = await this._gh(['search', 'issues', query, '--limit', '10']);
    const prs = await this._gh(['search', 'prs', query, '--limit', '10']);

    let msg = '';
    if (issues) msg += `### Issues\n\`\`\`\n${issues}\n\`\`\`\n\n`;
    if (prs) msg += `### Pull Requests\n\`\`\`\n${prs}\n\`\`\``;
    return ok(msg || 'No results found.');
  }

  // ── browse ───────────────────────────────────────────────

  async _browse(args) {
    const out = await this._gh(['browse', ...args, '--no-browser']);
    return ok(out || 'No URL returned.');
  }

  // ── help ─────────────────────────────────────────────────

  _help() {
    return ok(`# GitHub Skill — Full CLI

## Core
| Command | Description |
|---------|-------------|
| \`/gh status\` | Auth status and current repo context |
| \`/gh auth status\\|token\\|login\\|logout\\|refresh\\|switch\` | Manage authentication |
| \`/gh browse\` | Get the repo URL (or issue/PR URL with args) |

## Repositories
| Command | Description |
|---------|-------------|
| \`/gh repo view [name]\` | Show repo info |
| \`/gh repo list [owner]\` | List repositories |
| \`/gh repo create <name>\` | Create repo (default: private) |
| \`/gh repo init <name>\` | Create repo and link to current directory |
| \`/gh repo link <owner/repo>\` | Add GitHub remote to local repo |
| \`/gh repo clone <owner/repo>\` | Clone a repository |
| \`/gh repo fork [repo]\` | Fork a repository |
| \`/gh repo edit [--description ...]\` | Edit repo settings |
| \`/gh repo delete <repo> --yes\` | Delete a repository |
| \`/gh repo archive\\|unarchive [repo]\` | Archive/unarchive |
| \`/gh repo rename <new-name>\` | Rename current repo |
| \`/gh repo sync\` | Sync fork with upstream |
| \`/gh repo deploy-key list\\|add\\|delete\` | Manage deploy keys |

## Pull Requests
| Command | Description |
|---------|-------------|
| \`/gh pr list\` | List open PRs |
| \`/gh pr view <n>\` | View PR details |
| \`/gh pr create <title>\` | Create PR from current branch |
| \`/gh pr merge <n>\` | Merge a PR |
| \`/gh pr close\\|reopen <n>\` | Close or reopen |
| \`/gh pr checkout <n>\` | Check out PR branch |
| \`/gh pr diff <n>\` | Show PR diff |
| \`/gh pr ready <n>\` | Mark as ready for review |
| \`/gh pr comment <n> <body>\` | Add a comment |
| \`/gh pr edit <n> [--title ...]\` | Edit PR metadata |
| \`/gh pr checks <n>\` | View CI check status |
| \`/gh pr review <n>\` | AI-assisted code review |

## Issues
| Command | Description |
|---------|-------------|
| \`/gh issue list\` | List open issues |
| \`/gh issue view <n>\` | View issue details |
| \`/gh issue create <title>\` | Create a new issue |
| \`/gh issue close\\|reopen <n>\` | Close or reopen |
| \`/gh issue comment <n> <body>\` | Add a comment |
| \`/gh issue edit <n> [--title ...]\` | Edit issue metadata |
| \`/gh issue transfer <n> <repo>\` | Transfer to another repo |
| \`/gh issue pin\\|unpin <n>\` | Pin/unpin issue |
| \`/gh issue lock\\|unlock <n>\` | Lock/unlock issue |
| \`/gh issue delete <n>\` | Delete an issue |

## Releases
| Command | Description |
|---------|-------------|
| \`/gh release list\` | List releases |
| \`/gh release view <tag>\` | View release details |
| \`/gh release create <tag>\` | Create a release |
| \`/gh release edit\\|delete <tag>\` | Edit or delete |
| \`/gh release upload <tag> <file>\` | Upload assets |
| \`/gh release download <tag>\` | Download assets |

## Actions
| Command | Description |
|---------|-------------|
| \`/gh run list\` | List workflow runs |
| \`/gh run view\\|watch <id>\` | View or stream run |
| \`/gh run rerun <id> [--failed]\` | Re-run a workflow |
| \`/gh run cancel\\|delete <id>\` | Cancel or delete run |
| \`/gh run download <id>\` | Download artifacts |
| \`/gh workflow list\` | List workflows |
| \`/gh workflow view\\|run <id>\` | View or trigger workflow |
| \`/gh workflow enable\\|disable <id>\` | Toggle workflow |
| \`/gh cache list\` | List action caches |
| \`/gh cache delete <key>\` | Delete cache entry |

## Admin & Config
| Command | Description |
|---------|-------------|
| \`/gh secret list\\|set\\|delete\` | Manage secrets |
| \`/gh variable list\\|get\\|set\\|delete\` | Manage variables |
| \`/gh label list\\|create\\|edit\\|delete\\|clone\` | Manage labels |
| \`/gh ruleset list\\|view\\|check\` | View rulesets |
| \`/gh ssh-key list\\|add\\|delete\` | Manage SSH keys |
| \`/gh gpg-key list\\|add\\|delete\` | Manage GPG keys |
| \`/gh org list\` | List organizations |

## Other
| Command | Description |
|---------|-------------|
| \`/gh gist list\\|view\\|create\\|edit\\|delete\` | Manage gists |
| \`/gh project list\\|view\\|create\\|edit\\|...\` | GitHub Projects |
| \`/gh codespace list\\|create\\|delete\\|...\` | Codespaces |
| \`/gh search repos\\|issues\\|prs\\|commits\\|code <q>\` | Search GitHub |
| \`/gh api <endpoint> [--method ...]\` | Raw GitHub API call |
| \`/gh <anything else>\` | Passthrough to gh CLI |`);
  }

  async getHelp() {
    return this._help().message;
  }

  async cleanup() {}
}

module.exports = GitHubSkill;
