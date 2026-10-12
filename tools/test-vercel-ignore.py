"""Exercise actual ignoreCommand values against real Git history; no deployments."""
import json, os, pathlib, subprocess, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
configs = {p.parent.name: json.loads(p.read_text())['ignoreCommand'] for p in ROOT.glob('*/vercel.json')}
assert all(len(cmd) <= 256 for cmd in configs.values())
with tempfile.TemporaryDirectory() as directory:
    repo = pathlib.Path(directory)
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=repo, stderr=subprocess.DEVNULL).decode().strip()
    def commit(path):
        p = repo / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(p.read_text() + 'change\n' if p.exists() else 'change\n')
        git('add', '.'); git('commit', '-qm', 'fixture')
        return git('rev-parse', 'HEAD')
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
    for name in configs:
        (repo / name).mkdir()
        (repo / name / 'vercel-ignore.sh').write_text((ROOT / name / 'vercel-ignore.sh').read_text())
    base = commit('README.md')
    count = 0
    def check(name, previous, expected, force='0'):
        global count
        env = dict(os.environ, VERCEL_GIT_PREVIOUS_SHA=previous, VERCEL_FORCE_BUILD=force)
        result = subprocess.run(configs[name], shell=True, cwd=repo/name, env=env, capture_output=True)
        assert (result.returncode == 0) == (expected == 'skip'), (name, expected, result.returncode, result.stderr)
        count += 1
    commit('sim10/public/app.css')
    for name in configs: check(name, base, 'build' if name == 'sim10' else 'skip')
    # Earlier undeployed changes must still build even if the newest commit is docs-only.
    commit('README.md')
    check('sim10', base, 'build'); check('sim09', base, 'skip')
    base = git('rev-parse', 'HEAD')
    commit('platform/lib/session-sims.js')
    for name in configs: check(name, base, 'build' if name in ['platform', 'sim04'] else 'skip')
    base = git('rev-parse', 'HEAD'); commit('package-lock.json')
    for name in configs: check(name, base, 'build')
    for name in configs:
        check(name, '', 'build'); check(name, 'a'*40, 'build')
        check(name, git('rev-parse', 'HEAD'), 'build')
        check(name, base, 'build', force='1')
    # Deletions and renames out of a project must trigger its build.
    base = git('rev-parse', 'HEAD')
    git('mv', 'sim10/public/app.css', 'sim09/app.css'); git('commit', '-qm', 'move')
    check('sim10', base, 'build'); check('sim09', base, 'build'); check('sim08', base, 'skip')
    print(f'{count} deployment-selection checks passed across {len(configs)} projects')
