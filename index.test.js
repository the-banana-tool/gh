const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Shim king-louie/skill-interface so tests run standalone
const SKILL_MODULE_ID = 'king-louie/skill-interface';
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === SKILL_MODULE_ID) return SKILL_MODULE_ID;
  return origResolve.call(this, request, ...rest);
};
class Skill {}
require.cache[SKILL_MODULE_ID] = { id: SKILL_MODULE_ID, exports: { Skill }, loaded: true, filename: SKILL_MODULE_ID };

const GitHubSkill = require('./index');

function createSkill() {
  const skill = new GitHubSkill();
  skill.cwd = '/fake/repo';
  return skill;
}

function stubGh(skill, responses) {
  const calls = [];
  skill._gh = async (args) => {
    calls.push(args);
    const key = args.join(' ');
    for (const [pattern, value] of responses) {
      if (typeof pattern === 'function' ? pattern(args) : key.includes(pattern)) {
        if (value instanceof Error) throw value;
        return value;
      }
    }
    return '';
  };
  return calls;
}

// --- metadata & lifecycle ---

describe('GitHubSkill', () => {
  let skill;

  beforeEach(() => {
    skill = createSkill();
  });

  describe('getMetadata', () => {
    it('returns correct metadata', () => {
      const meta = skill.getMetadata();
      assert.strictEqual(meta.id, 'gh');
      assert.strictEqual(meta.name, 'GitHub');
      assert.deepStrictEqual(meta.commands, ['gh']);
      assert.deepStrictEqual(meta.resolvers, ['code', 'cli']);
    });

    it('declares systemDependencies for gh and git', () => {
      const meta = skill.getMetadata();
      assert.ok(Array.isArray(meta.systemDependencies), 'systemDependencies should be an array');
      assert.strictEqual(meta.systemDependencies.length, 2);

      const ghDep = meta.systemDependencies.find((d) => d.command === 'gh');
      assert.ok(ghDep, 'should declare gh dependency');
      assert.strictEqual(ghDep.required, true);
      assert.ok(ghDep.installUrl, 'gh dep should have installUrl');
      assert.ok(ghDep.install.win, 'gh dep should have Windows install command');
      assert.ok(ghDep.install.mac, 'gh dep should have macOS install command');
      assert.ok(ghDep.install.linux, 'gh dep should have Linux install command');

      const gitDep = meta.systemDependencies.find((d) => d.command === 'git');
      assert.ok(gitDep, 'should declare git dependency');
      assert.strictEqual(gitDep.required, true);
      assert.ok(gitDep.installUrl, 'git dep should have installUrl');
    });
  });

  describe('initialize', () => {
    it('stores context and working directory', async () => {
      await skill.initialize({ workingDirectory: '/my/repo', userDataPath: '/data' });
      assert.strictEqual(skill.cwd, '/my/repo');
      assert.strictEqual(skill.context.userDataPath, '/data');
    });
  });

  // --- resolveCode (help) ---

  describe('resolveCode', () => {
    it('returns help when no args', async () => {
      const result = await skill.resolveCode({ args: [] });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('GitHub Skill'));
    });

    it('returns help for "help" arg', async () => {
      const result = await skill.resolveCode({ args: ['help'] });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('/gh status'));
    });

    it('returns null for other args (falls through to cli)', async () => {
      const result = await skill.resolveCode({ args: ['pr', 'list'] });
      assert.strictEqual(result, null);
    });
  });

  // --- status ---

  describe('/gh status', () => {
    it('shows auth status and repo info', async () => {
      stubGh(skill, [
        ['auth status', 'Logged in to github.com as user1'],
        ['repo view --json', 'octocat/hello-world (default: main)']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['status'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('Logged in'));
      assert.ok(result.message.includes('octocat/hello-world'));
    });

    it('shows fallback when not in a repo', async () => {
      stubGh(skill, [
        ['auth status', 'Logged in to github.com as user1'],
        ['repo view --json', new Error('not a git repo')]
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['status'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('not inside a GitHub repo'));
    });
  });

  // --- pr list ---

  describe('/gh pr list', () => {
    it('lists open PRs', async () => {
      stubGh(skill, [
        ['pr list', '#1  Fix bug  main  OPEN']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('Fix bug'));
    });

    it('shows message when no PRs', async () => {
      stubGh(skill, [['pr list', '']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('No open pull requests'));
    });
  });

  // --- pr view ---

  describe('/gh pr view', () => {
    it('views PR details', async () => {
      stubGh(skill, [
        ['pr view 42', 'title: Fix bug\nstate: OPEN\nauthor: user1']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'view', '42'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('Fix bug'));
    });

    it('fails without number', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'view'], context: {} });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('Usage'));
    });
  });

  // --- pr create ---

  describe('/gh pr create', () => {
    it('creates a PR with title', async () => {
      const calls = stubGh(skill, [
        ['pr create', 'https://github.com/octocat/hello/pull/99']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'create', 'Add', 'feature'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('pull/99'));
      assert.ok(calls[0].includes('--title'));
      assert.ok(calls[0].includes('Add feature'));
    });

    it('fails without title', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'create'], context: {} });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('Usage'));
    });
  });

  // --- pr merge ---

  describe('/gh pr merge', () => {
    it('merges a PR', async () => {
      const calls = stubGh(skill, [
        ['pr merge', 'Merged pull request #42']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'merge', '42'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(calls[0].includes('--merge'));
    });

    it('shows default message when gh returns empty', async () => {
      stubGh(skill, [['pr merge', '']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'merge', '42'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('PR #42 merged'));
    });

    it('fails without number', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'merge'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- pr review ---

  describe('/gh pr review', () => {
    it('returns diff with continueWithAgent', async () => {
      stubGh(skill, [
        ['pr diff', '+ added line\n- removed line'],
        ['pr view', 'Fix login bug\nhttps://github.com/o/r/pull/5\n\nFixes #3']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'review', '5'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.continueWithAgent, true);
      assert.ok(result.message.includes('Fix login bug'));
      assert.ok(result.message.includes('+ added line'));
      assert.strictEqual(result.format, 'markdown');
    });

    it('fails without number', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'review'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- unknown pr action ---

  describe('/gh pr <unknown>', () => {
    it('returns error for unknown PR action', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'delete'], context: {} });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('Unknown PR action'));
    });
  });

  // --- issue list ---

  describe('/gh issue list', () => {
    it('lists open issues', async () => {
      stubGh(skill, [['issue list', '#1  Bug report  bug  OPEN']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('Bug report'));
    });

    it('shows message when no issues', async () => {
      stubGh(skill, [['issue list', '']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('No open issues'));
    });
  });

  // --- issue view ---

  describe('/gh issue view', () => {
    it('views issue details', async () => {
      stubGh(skill, [['issue view 7', 'title: Bug\nstate: OPEN']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'view', '7'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('Bug'));
    });

    it('fails without number', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'view'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- issue create ---

  describe('/gh issue create', () => {
    it('creates an issue', async () => {
      const calls = stubGh(skill, [
        ['issue create', 'https://github.com/octocat/hello/issues/10']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'create', 'New', 'bug'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('issues/10'));
      assert.ok(calls[0].includes('--title'));
      assert.ok(calls[0].includes('New bug'));
    });

    it('fails without title', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'create'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- issue close ---

  describe('/gh issue close', () => {
    it('closes an issue', async () => {
      stubGh(skill, [['issue close', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'close', '5'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('#5 closed'));
    });

    it('fails without number', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'close'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- unknown issue action ---

  describe('/gh issue <unknown>', () => {
    it('returns error for unknown issue action', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['issue', 'bogus'], context: {} });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('Unknown issue action'));
    });
  });

  // --- run list ---

  describe('/gh run list', () => {
    it('lists workflow runs', async () => {
      stubGh(skill, [['run list', 'ID 123  CI  completed  success']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('123'));
    });

    it('shows message when no runs', async () => {
      stubGh(skill, [['run list', '']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('No recent workflow runs'));
    });
  });

  // --- run view ---

  describe('/gh run view', () => {
    it('views run details', async () => {
      stubGh(skill, [['run view 123', 'ID: 123\nStatus: completed\nConclusion: success']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'view', '123'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('completed'));
    });

    it('fails without id', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'view'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- run watch ---

  describe('/gh run watch', () => {
    it('watches a run', async () => {
      stubGh(skill, [['run watch 456', 'Run 456 completed: success']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'watch', '456'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('success'));
    });

    it('fails without id', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'watch'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- run cancel ---

  describe('/gh run cancel', () => {
    it('cancels a run', async () => {
      stubGh(skill, [['run cancel', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'cancel', '789'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('fails without id', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'cancel'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- unknown run action ---

  describe('/gh run <unknown>', () => {
    it('returns error for unknown run action', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['run', 'bogus'], context: {} });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('Unknown run action'));
    });
  });

  // --- repo view ---

  describe('/gh repo view', () => {
    it('shows repo info', async () => {
      stubGh(skill, [['repo view', 'octocat/hello-world\nA greeting repo']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['repo', 'view'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('octocat/hello-world'));
    });

    it('works without explicit "view" action', async () => {
      stubGh(skill, [['repo view', 'octocat/hello-world']]);

      const result = await skill.resolveCli({ command: 'gh', args: ['repo'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('fails for unknown repo action', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['repo', 'bogus'], context: {} });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('Unknown repo action'));
    });
  });

  // --- search ---

  describe('/gh search', () => {
    it('searches issues and PRs', async () => {
      stubGh(skill, [
        ['search issues', '#1  Bug in login  repo  OPEN'],
        ['search prs', '#2  Fix login  repo  OPEN']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['search', 'login', 'bug'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('### Issues'));
      assert.ok(result.message.includes('### Pull Requests'));
      assert.ok(result.message.includes('Bug in login'));
      assert.ok(result.message.includes('Fix login'));
    });

    it('shows no results message when empty', async () => {
      stubGh(skill, [
        ['search issues', ''],
        ['search prs', '']
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['search', 'nonexistent'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('No results found'));
    });
  });

  // --- unknown resource (passthrough) ---

  describe('/gh <unknown>', () => {
    it('passes unknown resource directly to gh CLI', async () => {
      const calls = stubGh(skill, [['extension list', 'gh-copilot']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['extension', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(calls[0], ['extension', 'list']);
    });
  });

  // --- help in resolveCli ---

  describe('/gh help via resolveCli', () => {
    it('returns help when first arg is "help"', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['help'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('GitHub Skill'));
    });

    it('handles leading slash in resource (e.g. "/help")', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['/help'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('GitHub Skill'));
    });
  });

  // --- resolveCli with empty args ---

  describe('resolveCli with empty args', () => {
    it('returns null so code resolver handles it', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: [], context: {} });
      assert.strictEqual(result, null);
    });
  });

  // --- handleCommand delegates to resolveCli ---

  describe('handleCommand', () => {
    it('delegates to resolveCli for structured args', async () => {
      stubGh(skill, [['pr list', '#1 PR']]);

      const result = await skill.handleCommand('gh', ['pr', 'list'], {});
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('#1 PR'));
    });

    it('splits a single sentence arg into tokens', async () => {
      stubGh(skill, [['pr list', '#1 PR']]);

      const result = await skill.handleCommand('gh', ['pr list'], {});
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('#1 PR'));
    });

    it('passes unrecognized input through to gh CLI', async () => {
      stubGh(skill, [[() => true, new Error('unknown command "check"')]]);
      const result = await skill.handleCommand('gh', ['check all repos for remotes'], {});
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('unknown command'));
    });

    it('returns help for "help" as single arg', async () => {
      const result = await skill.handleCommand('gh', ['help'], {});
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('GitHub Skill'));
    });
  });

  // --- error handling ---

  describe('error handling', () => {
    it('catches gh CLI errors and returns fail result', async () => {
      stubGh(skill, [
        [(args) => true, new Error('gh: command not found')]
      ]);

      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'list'], context: {} });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('gh: command not found'));
    });
  });

  // --- getHelp ---

  describe('getHelp', () => {
    it('returns help markdown string', async () => {
      const help = await skill.getHelp();
      assert.ok(typeof help === 'string');
      assert.ok(help.includes('/gh pr list'));
      assert.ok(help.includes('/gh search'));
    });
  });

  // --- cleanup ---

  describe('cleanup', () => {
    it('resolves without error', async () => {
      await skill.cleanup();
    });
  });

  // --- releases ---

  describe('/gh release', () => {
    it('lists releases', async () => {
      stubGh(skill, [['release list', 'v1.0.0  Latest  2024-01-01']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['release', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('v1.0.0'));
    });

    it('creates a release', async () => {
      const calls = stubGh(skill, [['release create', 'https://github.com/o/r/releases/tag/v2.0']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['release', 'create', 'v2.0', '--notes', 'New'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(calls[0].includes('--notes'));
    });

    it('fails create without tag', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['release', 'create'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- gists ---

  describe('/gh gist', () => {
    it('lists gists', async () => {
      stubGh(skill, [['gist list', 'abc123  my-gist.js  1 file  public']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['gist', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('my-gist'));
    });

    it('fails view without id', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['gist', 'view'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- labels ---

  describe('/gh label', () => {
    it('lists labels', async () => {
      stubGh(skill, [['label list', 'bug  #d73a4a  Something broken']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['label', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('bug'));
    });

    it('creates a label', async () => {
      stubGh(skill, [['label create', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['label', 'create', 'feature', '--color', '0075ca'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- secrets ---

  describe('/gh secret', () => {
    it('lists secrets', async () => {
      stubGh(skill, [['secret list', 'MY_SECRET  Updated 2024-01-01']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['secret', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('MY_SECRET'));
    });

    it('fails set without name', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['secret', 'set'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- variables ---

  describe('/gh variable', () => {
    it('lists variables', async () => {
      stubGh(skill, [['variable list', 'MY_VAR  my-value  Updated 2024-01-01']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['variable', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('MY_VAR'));
    });

    it('gets a variable', async () => {
      stubGh(skill, [['variable get', 'production']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['variable', 'get', 'ENV'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- workflow ---

  describe('/gh workflow', () => {
    it('lists workflows', async () => {
      stubGh(skill, [['workflow list', 'CI  active  123']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['workflow', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('CI'));
    });

    it('triggers a workflow', async () => {
      stubGh(skill, [['workflow run', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['workflow', 'run', 'ci.yml'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- cache ---

  describe('/gh cache', () => {
    it('lists caches', async () => {
      stubGh(skill, [['cache list', 'node-modules  123MB  2024-01-01']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['cache', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- auth ---

  describe('/gh auth', () => {
    it('shows auth status', async () => {
      stubGh(skill, [['auth status', 'Logged in to github.com as user1']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['auth', 'status'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('returns token', async () => {
      stubGh(skill, [['auth token', 'ghp_xxxx']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['auth', 'token'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('ghp_xxxx'));
    });
  });

  // --- api ---

  describe('/gh api', () => {
    it('calls the API and formats JSON', async () => {
      stubGh(skill, [['api', '{"login":"user1"}']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['api', '/user'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('json'));
      assert.ok(result.message.includes('user1'));
    });

    it('fails without endpoint', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['api'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- org ---

  describe('/gh org', () => {
    it('lists orgs', async () => {
      stubGh(skill, [['org list', 'my-org\nother-org']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['org', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('my-org'));
    });
  });

  // --- project ---

  describe('/gh project', () => {
    it('lists projects', async () => {
      stubGh(skill, [['project list', '#1  My Board  open']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['project', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('fails for invalid action', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['project', 'bogus'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- ruleset ---

  describe('/gh ruleset', () => {
    it('lists rulesets', async () => {
      stubGh(skill, [['ruleset list', 'main-protection  active']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['ruleset', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- ssh-key ---

  describe('/gh ssh-key', () => {
    it('lists SSH keys', async () => {
      stubGh(skill, [['ssh-key list', 'ssh-ed25519 AAAA...  my-key']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['ssh-key', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- gpg-key ---

  describe('/gh gpg-key', () => {
    it('lists GPG keys', async () => {
      stubGh(skill, [['gpg-key list', 'ABCD1234  my-gpg-key']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['gpg-key', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- codespace ---

  describe('/gh codespace', () => {
    it('lists codespaces', async () => {
      stubGh(skill, [['codespace list', 'my-cs  AVAILABLE  main']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['codespace', 'list'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('fails for invalid action', async () => {
      const result = await skill.resolveCli({ command: 'gh', args: ['codespace', 'bogus'], context: {} });
      assert.strictEqual(result.ok, false);
    });
  });

  // --- browse ---

  describe('/gh browse', () => {
    it('returns repo URL', async () => {
      stubGh(skill, [['browse', 'https://github.com/octocat/hello-world']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['browse'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('github.com'));
    });
  });

  // --- search with type ---

  describe('/gh search with type', () => {
    it('searches repos by type', async () => {
      stubGh(skill, [['search repos', 'octocat/hello-world  A test repo']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['search', 'repos', 'hello'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('octocat'));
    });
  });

  // --- repo clone/fork/archive ---

  describe('/gh repo extended actions', () => {
    it('clones a repo', async () => {
      stubGh(skill, [['repo clone', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['repo', 'clone', 'octocat/hello'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('archives a repo', async () => {
      stubGh(skill, [['repo archive', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['repo', 'archive'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('deletes a repo', async () => {
      stubGh(skill, [['repo delete', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['repo', 'delete', 'octocat/hello'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- pr extended actions ---

  describe('/gh pr extended actions', () => {
    it('closes a PR', async () => {
      stubGh(skill, [['pr close', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'close', '10'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('checks out a PR', async () => {
      stubGh(skill, [['pr checkout', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'checkout', '10'], context: {} });
      assert.strictEqual(result.ok, true);
    });

    it('shows PR diff', async () => {
      stubGh(skill, [['pr diff', '+ line\n- line']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'diff', '10'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(result.message.includes('diff'));
    });

    it('adds a PR comment', async () => {
      const calls = stubGh(skill, [['pr comment', '']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'comment', '10', 'LGTM!'], context: {} });
      assert.strictEqual(result.ok, true);
      assert.ok(calls[0].includes('--body'));
    });

    it('views PR checks', async () => {
      stubGh(skill, [['pr checks', 'CI  pass  2m']]);
      const result = await skill.resolveCli({ command: 'gh', args: ['pr', 'checks', '10'], context: {} });
      assert.strictEqual(result.ok, true);
    });
  });

  // --- args passthrough ---

  describe('args passthrough', () => {
    it('passes extra args to pr list (e.g. --state closed)', async () => {
      const calls = stubGh(skill, [['pr list', '#5 Old PR  CLOSED']]);

      await skill.resolveCli({ command: 'gh', args: ['pr', 'list', '--state', 'closed'], context: {} });
      assert.deepStrictEqual(calls[0], ['pr', 'list', '--state', 'closed']);
    });

    it('passes extra args to issue list', async () => {
      const calls = stubGh(skill, [['issue list', '#1 Bug']]);

      await skill.resolveCli({ command: 'gh', args: ['issue', 'list', '--label', 'bug'], context: {} });
      assert.deepStrictEqual(calls[0], ['issue', 'list', '--label', 'bug']);
    });

    it('passes extra args to run list', async () => {
      const calls = stubGh(skill, [['run list', 'ID 1']]);

      await skill.resolveCli({ command: 'gh', args: ['run', 'list', '--limit', '5'], context: {} });
      assert.deepStrictEqual(calls[0], ['run', 'list', '--limit', '5']);
    });
  });
});
