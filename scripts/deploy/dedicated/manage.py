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

def healthy():
    with urllib.request.urlopen('http://127.0.0.1:18172/api/health', timeout=2) as r:
        body = json.load(r)
        mode = r.headers.get('X-NAVI-AI-Mode')
        if body.get('status') != 'ok' or type(body.get('aiProviderConfigured')) is not bool or mode not in ('live', 'unavailable'): raise RuntimeError('Unexpected API mode/configuration')
    with urllib.request.urlopen('http://127.0.0.1:18172/api/ai/status', timeout=2) as r:
        state = json.load(r)
        if state.get('mode') != mode or state.get('syntheticOnly') is not True or state.get('available') is not (mode == 'live') or (mode == 'live' and not body['aiProviderConfigured']): raise RuntimeError('Unsafe AI access mode')

def activate(target):
    target = release(target); old = release(ROOT / 'current') if (ROOT / 'current').exists() else None
    owned_service(); run(['nginx', '-t'])
    link('current', target)
    try:
        run(['systemctl', 'restart', UNIT])
        for attempt in range(20):
            try: healthy(); break
            except Exception:
                if attempt == 19: raise
                time.sleep(.5)
        run(['systemctl', 'reload', 'nginx'])
    except BaseException:
        if old:
            link('current', old)
            # Never restore a legacy public Demo API after a live-isolation failure.
            isolated = json.loads((old / 'ready.json').read_text()).get('providerIsolation') is True
            run(['systemctl', 'restart' if isolated else 'stop', UNIT]); run(['systemctl', 'reload', 'nginx'])
        else: run(['systemctl', 'stop', UNIT])
        raise
    if old and old != target: link('previous', old)
    print('Active: ' + str(target))

def main():
    p = argparse.ArgumentParser(); p.add_argument('action', choices=['install', 'activate', 'rollback', 'restart', 'stop', 'status']); p.add_argument('target', nargs='?'); p.add_argument('checksum', nargs='?'); args = p.parse_args()
    m = load()
    if args.action == 'install': install(m, args.target, args.checksum)
    elif args.action == 'activate': activate(args.target)
    elif args.action == 'rollback': activate(ROOT / 'previous')
    else:
        owned_service()
        if args.action == 'status': run(['systemctl', 'show', UNIT, 'nginx.service', '-p', 'Id', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'MemoryCurrent', '-p', 'NRestarts'])
        else: run(['systemctl', args.action, UNIT])
if __name__ == '__main__': main()
