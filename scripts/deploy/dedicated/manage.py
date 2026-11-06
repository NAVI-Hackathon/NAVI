#!/usr/bin/env python3
"""Manage only the marker-verified dedicated NAVI deployment; no OS installation."""
import argparse, hashlib, json, os, pathlib, pwd, re, subprocess, tarfile, time, urllib.request
ROOT = pathlib.Path('/opt/navi-hackathon')
NODE = ROOT / 'runtime/node/bin/node'
UNIT = 'navi-api.service'

def run(args, **kw): return subprocess.run(args, check=True, **kw)
def save(path, value):
    temp = path.with_suffix('.new')
    temp.write_text(json.dumps(value, indent=2) + '\n'); temp.chmod(0o600); temp.replace(path)
def load():
    if os.geteuid() != 0 or ROOT.is_symlink() or ROOT.resolve() != ROOT: raise RuntimeError('Unsafe deployment root/user')
    if ROOT.stat().st_uid != 0 or ROOT.stat().st_mode & 0o022: raise RuntimeError('Unsafe deployment ownership')
    marker = ROOT / '.dedicated-marker.json'
    if marker.is_symlink() or marker.stat().st_uid != 0 or marker.stat().st_mode & 0o077: raise RuntimeError('Unsafe marker')
    m = json.loads(marker.read_text())
    if m['kind'] != 'navi-dedicated-vps' or m['root'] != str(ROOT): raise RuntimeError('Wrong deployment kind')
    account = pwd.getpwnam('navi-hackathon')
    if account.pw_uid != m['uid'] or account.pw_gid != m['gid'] or account.pw_shell != '/usr/sbin/nologin': raise RuntimeError('Account identity changed')
    return m

def release(path):
    path = pathlib.Path(path).resolve()
    if path.parent != ROOT / 'releases' or not re.fullmatch(r'[a-f0-9]{12}-\d+', path.name) or not (path / 'ready.json').is_file(): raise RuntimeError('Unvalidated release')
    ready = path / 'ready.json'
    if ready.is_symlink() or ready.stat().st_uid != ROOT.stat().st_uid or ready.stat().st_mode & 0o022: raise RuntimeError('Unsealed release')
    return path

def install(m, artifact, checksum):
    artifact = pathlib.Path(artifact).resolve()
    if artifact.parent != ROOT / 'incoming' or not re.fullmatch(r'[a-f0-9]{64}', checksum): raise RuntimeError('Invalid incoming artifact')
    if hashlib.sha256(artifact.read_bytes()).hexdigest() != checksum: raise RuntimeError('Artifact checksum mismatch')
    with tarfile.open(artifact) as archive:
        members = archive.getmembers()
        if sum(p.size for p in members) > 64 * 1024**2 or len(members) > 10000: raise RuntimeError('Artifact too large')
        if any(pathlib.PurePosixPath(p.name).is_absolute() or '..' in pathlib.PurePosixPath(p.name).parts or not (p.isdir() or p.isfile()) for p in members): raise RuntimeError('Unsafe archive')
        meta = json.loads(archive.extractfile('release.json').read())
        if meta['origins'] != m['origins'] or not re.fullmatch(r'[a-f0-9]{40}', meta['sourceCommit']): raise RuntimeError('Wrong origins/revision')
        schema_file = archive.extractfile('apps/api/src/storage/schema-version.json') if 'apps/api/src/storage/schema-version.json' in archive.getnames() else None
        storage_schema = json.load(schema_file)['version'] if schema_file else 1
        if type(storage_schema) is not int or storage_schema not in (1, 2) or storage_schema != meta.get('storageSchema', 1):
            raise RuntimeError('Release storage schema does not match the sealed artifact')
        target = ROOT / 'releases' / f"{meta['sourceCommit'][:12]}-{int(time.time())}"
        target.mkdir(mode=0o755)
        archive.extractall(target, filter='data')
    for directory, dirs, files in os.walk(target):
        for p in [pathlib.Path(directory)] + [pathlib.Path(directory) / f for f in files]: os.chown(p, m['uid'], m['gid'])
    env = {'PATH': str(NODE.parent) + ':/usr/bin:/bin', 'HOME': str(ROOT / 'run'), 'TMPDIR': str(ROOT / 'run'), 'NPM_CONFIG_CACHE': str(ROOT / 'run/npm-cache'), 'NODE_ENV': 'production'}
    run(['/usr/sbin/runuser', '-u', 'navi-hackathon', '--', str(NODE), '--max-old-space-size=128', str(ROOT / 'runtime/node/lib/node_modules/npm/bin/npm-cli.js'), 'ci', '--workspace', '@navi/api', '--include-workspace-root', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=target, env=env)
    if list(target.rglob('*.node')) or (target / 'node_modules/next').exists(): raise RuntimeError('Unexpected native/Next runtime module')
    for directory, dirs, files in os.walk(target, followlinks=False):
        for p in [pathlib.Path(directory)] + [pathlib.Path(directory) / f for f in dirs + files]:
            if p.is_symlink():
                if not p.resolve().is_relative_to(target): raise RuntimeError('Dependency symlink escapes release')
                continue
            public = p == target or p.is_relative_to(target / 'web') or p.is_relative_to(target / 'mock')
            os.chown(p, 0, m['gid']); p.chmod((0o755 if public else 0o750) if p.is_dir() else (0o644 if public else 0o640))
    save(target / 'ready.json', {'sourceCommit': meta['sourceCommit'], 'sha256': checksum, 'origins': m['origins'], 'storageSchema': storage_schema, 'providerIsolation': meta.get('providerIsolation') is True and (target / 'apps/api/src/middleware/testSession.js').is_file()})
    print(str(target))

def owned_service():
    result = subprocess.check_output(['systemctl', 'show', UNIT, '-p', 'FragmentPath', '-p', 'Description'], text=True)
    state = dict(l.split('=', 1) for l in result.splitlines())
    if state['FragmentPath'] != '/etc/systemd/system/navi-api.service' or state['Description'] != 'NAVI Dedicated Demo API': raise RuntimeError('Unowned service')

def link(name, target):
    temp = ROOT / (name + '.new'); temp.symlink_to(target); temp.replace(ROOT / name)

def healthy():
    with urllib.request.urlopen('http://127.0.0.1:18172/api/health', timeout=2) as r:
        body = json.load(r)
        mode = r.headers.get('X-NAVI-AI-Mode')
        if body.get('status') != 'ok' or type(body.get('aiProviderConfigured')) is not bool or mode not in ('live', 'unavailable'): raise RuntimeError('Unexpected API mode/configuration')
    with urllib.request.urlopen('http://127.0.0.1:18172/api/ai/status', timeout=2) as r:
        state = json.load(r)
        if state.get('mode') != mode or state.get('syntheticOnly') is not True or state.get('available') is not (mode == 'live') or (mode == 'live' and not body['aiProviderConfigured']): raise RuntimeError('Unsafe AI access mode')
    if state.get('product', {}).get('enabled'):
        with urllib.request.urlopen('http://127.0.0.1:18172/api/ready', timeout=5) as r:
            ready = json.load(r)
            if ready.get('status') != 'ready' or ready.get('storage') != 'mongodb_encrypted': raise RuntimeError('Persistent storage is not ready')

def private_environment(path):
    path = pathlib.Path(path)
    if path.parent not in (ROOT / 'config', ROOT / 'config/release-env') or path.is_symlink(): raise RuntimeError('Unsafe environment path')
    st = path.stat()
    if not path.is_file() or st.st_uid != ROOT.stat().st_uid or st.st_mode & 0o077: raise RuntimeError('Unsafe environment permissions')
    return path.read_bytes()

def write_environment(path, data):
    if path.is_symlink(): raise RuntimeError('Unsafe environment destination')
    temp = path.with_suffix('.new')
    if temp.exists() or temp.is_symlink(): raise RuntimeError('Pending environment update exists')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    temp.replace(path)

def storage_schema(path):
    return json.loads((path / 'ready.json').read_text()).get('storageSchema', 1) if path else 1

def wait_healthy():
    for attempt in range(20):
        try: healthy(); return
        except Exception:
            if attempt == 19: raise
            time.sleep(.5)

AI_KEYS = (b'AI_MODE', b'AI_PROVIDER', b'GEMINI_API_KEY', b'ALLOW_PAID_AI')

def ollama_environment(data, target, *, allow_live=True):
    # Rewrite all assignments for these keys before writing the canonical policy.
    lines = data.splitlines(keepends=True)
    pattern = rb'^[ \t]*(' + b'|'.join(AI_KEYS) + rb')[ \t]*='
    control = {}
    other = []
    for line in lines:
        match = re.match(pattern, line)
        if not match:
            other.append(line)
            continue
        name = match[1]
        if name in control: raise RuntimeError('Duplicate AI environment assignment')
        control[name] = line[match.end():].strip()
    local = allow_live and control.get(b'AI_MODE') == b'live' and control.get(b'AI_PROVIDER') == b'ollama' and target and (target / 'apps/api/src/ai/ollamaProvider.js').is_file()
    mode = b'live' if local else b'unavailable'
    return b''.join(other).rstrip(b'\r\n') + b'\nAI_MODE=' + mode + b'\nAI_PROVIDER=ollama\nGEMINI_API_KEY=\nALLOW_PAID_AI=false\n'

def activate(target, environment=None, recovery=None, *, ollama_only=False):
    target = release(target)
    if json.loads((target / 'ready.json').read_text()).get('providerIsolation') is not True: raise RuntimeError('Legacy releases cannot be activated; use an isolated rollback target')
    old = release(ROOT / 'current') if (ROOT / 'current').exists() else None
    current_schema, target_schema = storage_schema(old), storage_schema(target)
    if target_schema < current_schema: raise RuntimeError('Rollback would interrupt the erasure ledger')
    if target_schema > current_schema:
        if environment: raise RuntimeError('An erasure cutover must retain the current database environment')
        if not recovery: raise RuntimeError('Stage a tested recovery release with the new storage schema first')
        recovery = release(recovery)
        if recovery == target or storage_schema(recovery) != target_schema or json.loads((recovery / 'ready.json').read_text()).get('providerIsolation') is not True:
            raise RuntimeError('Recovery release does not support the erasure ledger')
    elif recovery:
        raise RuntimeError('A recovery override applies only to a storage upgrade')
    fallback = recovery or old
    owned_service(); run(['nginx', '-t'])
    env = ROOT / 'config/api.env'
    old_env = private_environment(env) if env.exists() else None
    snapshots = ROOT / 'config/release-env'
    if snapshots.is_symlink(): raise RuntimeError('Unsafe environment snapshots')
    if env.exists():
        snapshots.mkdir(mode=0o700, exist_ok=True)
        if snapshots.stat().st_uid != ROOT.stat().st_uid or snapshots.stat().st_mode & 0o077: raise RuntimeError('Unsafe snapshots permissions')
        if old: write_environment(snapshots / (old.name + '.env'), old_env)
    saved = snapshots / (target.name + '.env')
    next_env = private_environment(environment) if environment else private_environment(saved) if saved.exists() else old_env
    if environment and old_env is None: raise RuntimeError('Missing existing environment')
    marker = ROOT / 'config/ollama-only'
    locked = marker.exists() or marker.is_symlink()
    if locked and private_environment(marker) != b'ollama-only-v1\n': raise RuntimeError('Invalid local AI policy marker')
    if ollama_only:
        if not environment or not next_env or b'\nAI_MODE=live\n' not in ollama_environment(next_env, target):
            raise RuntimeError('Initial local-only cutover requires an explicit live Ollama release environment')
        if not locked: write_environment(marker, b'ollama-only-v1\n')
    locked = locked or ollama_only
    if locked:
        if next_env is None: raise RuntimeError('Local-only release environment is missing')
        next_env = ollama_environment(next_env, target)
    if next_env is not None: write_environment(env, next_env)
    link('current', target)
    try:
        run(['systemctl', 'restart', UNIT])
        wait_healthy()
        run(['systemctl', 'reload', 'nginx'])
    except BaseException:
        if old_env is not None: write_environment(env, ollama_environment(old_env, fallback, allow_live=False) if locked else old_env)
        if fallback:
            link('current', fallback)
            # A failed storage upgrade can only recover onto another ledger-compatible writer.
            isolated = json.loads((fallback / 'ready.json').read_text()).get('providerIsolation') is True
            run(['systemctl', 'restart' if isolated else 'stop', UNIT])
            if recovery:
                try: wait_healthy()
                except Exception:
                    run(['systemctl', 'stop', UNIT])
                    raise
            run(['systemctl', 'reload', 'nginx'])
        else: run(['systemctl', 'stop', UNIT])
        raise
    if next_env is not None: write_environment(saved, next_env)
    if fallback and fallback != target: link('previous', fallback)
    print('Active: ' + str(target))

def main():
    p = argparse.ArgumentParser(); p.add_argument('action', choices=['install', 'activate', 'rollback', 'restart', 'stop', 'status']); p.add_argument('target', nargs='?'); p.add_argument('checksum', nargs='?'); p.add_argument('--environment'); p.add_argument('--recovery'); p.add_argument('--ollama-only', action='store_true'); args = p.parse_args()
    m = load()
    if args.action == 'install': install(m, args.target, args.checksum)
    elif args.action == 'activate': activate(args.target, args.environment, args.recovery, ollama_only=args.ollama_only)
    elif args.action == 'rollback': activate(ROOT / 'previous')
    else:
        owned_service()
        if args.action == 'status': run(['systemctl', 'show', UNIT, 'nginx.service', '-p', 'Id', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'MemoryCurrent', '-p', 'NRestarts'])
        else:
            marker = ROOT / 'config/ollama-only'
            if args.action == 'restart' and (marker.exists() or marker.is_symlink()):
                if private_environment(marker) != b'ollama-only-v1\n': raise RuntimeError('Invalid local AI policy marker')
                env = ROOT / 'config/api.env'
                write_environment(env, ollama_environment(private_environment(env), release(ROOT / 'current')))
            run(['systemctl', args.action, UNIT])
if __name__ == '__main__': main()
