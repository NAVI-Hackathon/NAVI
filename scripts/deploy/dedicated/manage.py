#!/usr/bin/env python3
"""Manage only the marker-verified dedicated NAVI deployment; no OS installation."""
import contextlib, fcntl, http.client
import argparse, hashlib, json, os, pathlib, pwd, re, subprocess, tarfile, time, urllib.request
ROOT = pathlib.Path('/opt/navi-hackathon')
NODE = ROOT / 'runtime/node/bin/node'
UNIT = 'navi-api.service'
API_PORT = 18172

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
    save(target / 'ready.json', {'sourceCommit': meta['sourceCommit'], 'sha256': checksum, 'origins': m['origins'], 'providerIsolation': meta.get('providerIsolation') is True and (target / 'apps/api/src/middleware/testSession.js').is_file()})
    print(str(target))

def owned_service():
    result = subprocess.check_output(['systemctl', 'show', UNIT, '-p', 'FragmentPath', '-p', 'Description'], text=True)
    state = dict(l.split('=', 1) for l in result.splitlines())
    if state['FragmentPath'] != '/etc/systemd/system/navi-api.service' or state['Description'] != 'NAVI Dedicated Demo API': raise RuntimeError('Unowned service')

def link(name, target):
    temp = ROOT / (name + '.new'); temp.symlink_to(target); temp.replace(ROOT / name)

def request_json(path, timeout):
    # A fresh connection cannot reuse a socket belonging to the previous process.
    connection = http.client.HTTPConnection('127.0.0.1', API_PORT, timeout=timeout)
    try:
        connection.request('GET', path, headers={'Connection': 'close'})
        response = connection.getresponse()
        if response.status != 200: raise RuntimeError('API not ready')
        return json.load(response), response.getheader('X-NAVI-AI-Mode')
    finally: connection.close()

def service_state():
    raw = subprocess.check_output(['systemctl', 'show', UNIT, '-p', 'ActiveState', '-p', 'SubState', '-p', 'MainPID', '-p', 'NRestarts', '-p', 'ExecMainStartTimestampMonotonic', '-p', 'StartLimitIntervalUSec', '-p', 'StartLimitBurst', '-p', 'ExecStart', '-p', 'WorkingDirectory'], text=True)
    return dict(line.split('=', 1) for line in raw.splitlines())

def host_uptime():
    return float(pathlib.Path('/proc/uptime').read_text().split()[0])

def preflight_start():
    state = service_state()
    if '/api-current/' not in state.get('ExecStart', '') or state.get('WorkingDirectory') != str(ROOT / 'api-current'):
        raise RuntimeError('Migrate the NAVI unit to api-current before activation; nothing changed')
    if state.get('ActiveState') in ('activating', 'deactivating') or state.get('SubState') == 'auto-restart': raise RuntimeError('NAVI is already changing state')
    interval = state['StartLimitIntervalUSec']
    # This deployment is validated against the existing 300-second/3-start protection.
    if interval not in ('5min', '300s') or int(state['StartLimitBurst']) < 3: raise RuntimeError('Review unexpected start protection before deploying')
    uptime = host_uptime()
    started = int(state.get('ExecMainStartTimestampMonotonic', '0')) / 1000000
    if started and uptime - started < 300: raise RuntimeError('Wait for the current 300-second start window before deploying')

@contextlib.contextmanager
def deployment_lock(rollback_target=None):
    directory = ROOT / 'config'
    if directory.is_symlink(): raise RuntimeError('Unsafe deployment state')
    directory.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(directory / 'deployment.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        if os.fstat(fd).st_uid != ROOT.stat().st_uid or os.fstat(fd).st_mode & 0o077: raise RuntimeError('Unsafe deployment lock')
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('Another NAVI deployment is running')
        state = directory / 'deployment-window.json'
        if state.exists():
            previous = json.loads(state.read_text())
            if time.time() - previous['startedAt'] < 300:
                service = service_state() if rollback_target else {}
                reserved = rollback_target and previous.get('rollbackAvailable') and previous.get('rollbackTarget') == str(rollback_target) and previous.get('activePid') == service.get('MainPID') and service.get('ActiveState') == 'active' and int(service.get('NRestarts', '0')) == 0
                if not reserved: raise RuntimeError('Wait for the 300-second deployment window; no service changed')
                previous.update(rollbackAvailable=False, rollbackConsumed=True); save(state, previous)
                yield; return
        preflight_start()
        save(state, {'startedAt': time.time(), 'rollbackAvailable': False, 'rollbackConsumed': False})
        yield
    finally: os.close(fd)

def process_release(pid):
    return pathlib.Path('/proc/' + pid + '/cwd').resolve()

def healthy(expected=None, product=False):
    body, mode = request_json('/api/health', 1)
    if body.get('status') != 'ok' or type(body.get('aiProviderConfigured')) is not bool or mode not in ('live', 'unavailable'): raise RuntimeError('Unexpected API mode/configuration')
    state, _ = request_json('/api/ai/status', 1)
    if state.get('mode') != mode or state.get('syntheticOnly') is not True or state.get('available') is not (mode == 'live') or (mode == 'live' and not body['aiProviderConfigured']): raise RuntimeError('Unsafe AI access mode')
    if product or expected is not None or state.get('product', {}).get('enabled'):
        ready, _ = request_json('/api/ready', 1)
        if ready.get('status') != 'ready' or ready.get('storage') != 'mongodb_encrypted': raise RuntimeError('Persistent storage is not ready')
    if expected:
        service = service_state()
        if service['ActiveState'] != 'active' or process_release(service['MainPID']) != expected: raise RuntimeError('API process does not match the release')

def wait_healthy(target, product=False):
    deadline = time.monotonic() + 25
    while True:
        state = service_state()
        if state['ActiveState'] == 'failed' or state.get('SubState') == 'auto-restart' or int(state.get('NRestarts', '0')) > 0: raise RuntimeError('Candidate failed to start; no repeated restart')
        try: healthy(target, product); return
        except Exception:
            if time.monotonic() >= deadline: raise
            time.sleep(1)

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

def activate(target, environment=None, rollback=False):
    target = release(target)
    if json.loads((target / 'ready.json').read_text()).get('providerIsolation') is not True: raise RuntimeError('Legacy release is not isolated')
    if environment is None and (ROOT / 'current').exists() and target == release(ROOT / 'current'):
        healthy(target); print('Already active: ' + str(target)); return
    with deployment_lock(target if rollback else None): return activate_once(target, environment)

def activate_once(target, environment=None):
    target = release(target)
    if json.loads((target / 'ready.json').read_text()).get('providerIsolation') is not True: raise RuntimeError('Legacy releases cannot be activated; use an isolated rollback target')
    old = release(ROOT / 'current') if (ROOT / 'current').exists() else None
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
    event = {'target': str(target), 'previous': str(old) if old else None, 'startedAt': time.time()}
    try:
        if next_env is not None: write_environment(env, next_env)
        link('api-current', target)
        run(['systemctl', 'restart', UNIT])
        wait_healthy(target, bool(next_env and b'NAVI_PRODUCT_MODE=true' in next_env.splitlines()))
        link('current', target)
        run(['systemctl', 'reload', 'nginx'])
    except BaseException:
        event['failedAt'] = time.time()
        save(ROOT / 'config' / ('deployment-failed-' + str(time.time_ns()) + '.json'), event)
        run(['systemctl', 'stop', UNIT])
        if old_env is not None: write_environment(env, old_env)
        if old:
            link('api-current', old); link('current', old)
            # Never restore a legacy public Demo API after a live-isolation failure.
            isolated = json.loads((old / 'ready.json').read_text()).get('providerIsolation') is True
            try:
                if isolated:
                    run(['systemctl', 'start', UNIT]); wait_healthy(old, bool(old_env and b'NAVI_PRODUCT_MODE=true' in old_env.splitlines()))
                    event['recoveredAt'] = time.time()
                run(['systemctl', 'reload', 'nginx'])
            finally: save(ROOT / 'config' / ('deployment-' + str(time.time_ns()) + '.json'), event)
        else: run(['systemctl', 'stop', UNIT])
        raise
    event['readyAt'] = time.time(); save(ROOT / 'config' / ('deployment-' + str(time.time_ns()) + '.json'), event)
    if next_env is not None: write_environment(saved, next_env)
    if old and old != target:
        link('previous', old)
        state = ROOT / 'config/deployment-window.json'; window = json.loads(state.read_text())
        window.update(rollbackAvailable=not window.get('rollbackConsumed', False), rollbackTarget=str(old), activePid=service_state()['MainPID']); save(state, window)
    print('Active: ' + str(target))

def main():
    p = argparse.ArgumentParser(); p.add_argument('action', choices=['install', 'activate', 'rollback', 'restart', 'stop', 'status']); p.add_argument('target', nargs='?'); p.add_argument('checksum', nargs='?'); p.add_argument('--environment'); args = p.parse_args()
    m = load()
    if args.action == 'install': install(m, args.target, args.checksum)
    elif args.action == 'activate': activate(args.target, args.environment)
    elif args.action == 'rollback': activate(ROOT / 'previous', rollback=True)
    else:
        owned_service()
        if args.action == 'status': run(['systemctl', 'show', UNIT, 'nginx.service', '-p', 'Id', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'MemoryCurrent', '-p', 'NRestarts'])
        elif args.action == 'restart':
            with deployment_lock():
                target = release(ROOT / 'current'); run(['systemctl', 'restart', UNIT]); wait_healthy(target)
        else: run(['systemctl', args.action, UNIT])
if __name__ == '__main__': main()
