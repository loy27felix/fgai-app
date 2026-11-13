#!/usr/bin/env python3
"""Read the internal balance service and push a daily Feishu automation webhook."""
import argparse
import datetime as dt
import fcntl
import json
import math
import os
import pathlib
import plistlib
import re
import subprocess
import sys
import time
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent
LABEL = 'com.fgstudio.wetoken-balance-notifier'
BEIJING = dt.timezone(dt.timedelta(hours=8))
BALANCE_READER = r"""
try {
 const response = await fetch('http://127.0.0.1:3011/api/fg/finance/balance-report', {
  headers: {authorization: 'Bearer ' + process.env.FG_BALANCE_REPORT_TOKEN},
  redirect: 'error', signal: AbortSignal.timeout(25000)
 });
 if (!response.ok) throw Error('BALANCE_READ_FAILED');
 const value = await response.json();
 const fields = ['provider', 'currency', 'available', 'balance', 'updatedAt', 'stale', 'reportedAt', 'message'];
 console.log(JSON.stringify(Object.fromEntries(fields.map(key => [key, value[key]]))));
} catch {
 console.error('BALANCE_READ_FAILED'); process.exitCode = 1;
}
"""


class NotifyError(Exception):
    pass


def load_settings():
    path = ROOT / '.env'
    info = path.stat()
    if path.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise NotifyError('PRIVATE_CONFIG_PERMISSIONS_REQUIRED')
    settings = {}
    for line in path.read_text().splitlines():
        key, separator, value = line.partition('=')
        if separator:
            settings[key.strip()] = value.strip()
    url = settings.get('FG_BALANCE_NOTIFY_WEBHOOK_URL', '')
    token = settings.get('FG_BALANCE_NOTIFY_WEBHOOK_TOKEN', '')
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname != 'qse0r9si7g.feishu.cn'
            or parsed.port not in (None, 443) or parsed.username or parsed.password
            or parsed.fragment or not parsed.path.startswith('/base/automation/webhook/event/')):
        raise NotifyError('FEISHU_AUTOMATION_WEBHOOK_REQUIRED')
    if not re.fullmatch(r'[A-Za-z0-9_.~-]{16,512}', token):
        raise NotifyError('WEBHOOK_BEARER_TOKEN_REQUIRED')
    return url, token


def read_balance():
    result = subprocess.run(
        ['/usr/local/bin/docker', 'exec', '-i', 'fg-wetoken-balance-report',
         'node', '--input-type=module', '-'],
        input=BALANCE_READER, text=True, capture_output=True, timeout=35)
    if result.returncode:
        raise NotifyError('INTERNAL_BALANCE_READ_FAILED')
    report = json.loads(result.stdout)
    if (report.get('provider') != 'WeToken' or report.get('currency') != 'USD'
            or type(report.get('available')) is not bool or type(report.get('stale')) is not bool
            or not isinstance(report.get('message'), str) or not 1 <= len(report['message']) <= 5000):
        raise NotifyError('INVALID_BALANCE_REPORT')
    if report['available']:
        amount = report.get('balance')
        if type(amount) not in (int, float) or not math.isfinite(amount):
            raise NotifyError('INVALID_BALANCE_AMOUNT')
        updated = dt.datetime.fromisoformat(report['updatedAt'].replace('Z', '+00:00'))
        age = (dt.datetime.now(BEIJING) - updated).total_seconds()
        if not report['stale'] and not -30 <= age <= 120:
            raise NotifyError('BALANCE_FRESHNESS_MISMATCH')
    elif report.get('balance') is not None:
        raise NotifyError('UNAVAILABLE_BALANCE_MUST_BE_NULL')
    return report


def unavailable_report(now):
    return {
        'available': False, 'balance': None, 'updatedAt': None, 'stale': False,
        'message': 'WeToken 每日账户余额\n报告时间：' + now.strftime('%Y/%m/%d %H:%M:%S')
        + '（北京时间）\n本次余额获取失败，剩余余额未知；请检查项目中的 WeToken 账单授权及余额服务。',
    }


def post_report(url, token, report):
    payload = json.dumps({'message': report['message']}, ensure_ascii=False)
    # Keep webhook credentials out of process arguments and logs.
    # Webhook 凭证仅经 stdin 传递，不进入进程参数或日志。
    config = '\n'.join([
        'url = ' + json.dumps(url), 'request = "POST"',
        'header = "Content-Type: application/json"',
        'header = ' + json.dumps('Authorization: Bearer ' + token),
        'data-binary = ' + json.dumps(payload, ensure_ascii=False),
        'silent', 'show-error', 'connect-timeout = 10', 'max-time = 30',
        'proto = "=https"', 'write-out = "\\n%{http_code}"',
    ])
    result = subprocess.run(['/usr/bin/curl', '--config', '-'], input=config,
                            text=True, capture_output=True, timeout=35)
    if result.returncode:
        raise NotifyError('WEBHOOK_NETWORK_ERROR_DELIVERY_UNCONFIRMED')
    body, status = result.stdout.rsplit('\n', 1)
    if not 200 <= int(status) < 300:
        raise NotifyError('WEBHOOK_HTTP_' + str(int(status)))
    response = json.loads(body)
    if type(response.get('code')) is not int or response['code'] != 0:
        raise NotifyError('WEBHOOK_REJECTED')


def atomic_write(path, content):
    temporary = path.with_suffix(path.suffix + '.new')
    with temporary.open('wb') as stream:
        stream.write(content)
    temporary.chmod(0o600)
    temporary.replace(path)


def install():
    load_settings()
    if time.timezone != -28800 or time.daylight:
        raise NotifyError('HOST_TIMEZONE_MUST_BE_UTC_PLUS_8_WITHOUT_DST')
    domain = 'gui/' + str(os.getuid())
    target = pathlib.Path.home() / 'Library' / 'LaunchAgents' / (LABEL + '.plist')
    document = {
        'Label': LABEL,
        'ProgramArguments': [sys.executable, str(ROOT / 'notify-balance.py')],
        'WorkingDirectory': str(ROOT), 'RunAtLoad': True,
        'StartCalendarInterval': {'Hour': 10, 'Minute': 0},
        'StandardOutPath': str(ROOT / 'notify.log'),
        'StandardErrorPath': str(ROOT / 'notify-error.log'),
        'EnvironmentVariables': {'TZ': 'Asia/Shanghai'},
    }
    loaded = subprocess.run(['/bin/launchctl', 'print', domain + '/' + LABEL],
                            text=True, capture_output=True)
    if loaded.returncode == 0:
        if not target.is_file() or plistlib.loads(target.read_bytes()) != document:
            raise NotifyError('LOADED_NOTIFIER_DIFFERS_LEAVE_UNCHANGED')
        print(json.dumps({'event': 'already_loaded', 'schedule': '10:00 Asia/Shanghai'}))
        return
    if 'Could not find service' not in loaded.stderr:
        raise NotifyError('CANNOT_DETERMINE_NOTIFIER_STATE')
    disabled = subprocess.run(['/bin/launchctl', 'print-disabled', domain],
                              text=True, capture_output=True, check=True)
    if re.search(r'"' + re.escape(LABEL) + r'"\s*=>\s*(?:disabled|true)\b', disabled.stdout):
        raise NotifyError('NOTIFIER_EXPLICITLY_DISABLED')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.plist.new')
    atomic_write(temporary, plistlib.dumps(document))
    subprocess.run(['/usr/bin/plutil', '-lint', str(temporary)], capture_output=True, check=True)
    temporary.replace(target)
    subprocess.run(['/bin/launchctl', 'bootstrap', domain, str(target)], capture_output=True, check=True)
    print(json.dumps({'event': 'installed', 'schedule': '10:00 Asia/Shanghai'}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--dry-run', action='store_true', help='read balance without sending or changing state')
    modes.add_argument('--send-now', action='store_true', help='explicitly send a fresh report, even if sent today')
    modes.add_argument('--install', action='store_true', help='register a missing 10:00 job without stopping any job')
    args = parser.parse_args()
    if args.install:
        install()
        return
    url, token = load_settings()
    with (ROOT / 'notify.lock').open('a') as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'event': 'already_running'}))
            return
        now = dt.datetime.now(BEIJING)
        day = now.date().isoformat()
        state_path = ROOT / 'last-accepted.json'
        if not args.dry_run and not args.send_now:
            state = json.loads(state_path.read_text()) if state_path.exists() else {}
            if (now.hour, now.minute) < (10, 0) or state.get('day') == day:
                print(json.dumps({'event': 'not_due', 'day': day}))
                return
        try:
            report = read_balance()
        except Exception:
            if args.dry_run:
                raise NotifyError('INTERNAL_BALANCE_READ_FAILED')
            report = unavailable_report(now)
        result = {key: report[key] for key in ['available', 'balance', 'stale', 'updatedAt']}
        if args.dry_run:
            print(json.dumps({'event': 'dry_run', **result}))
            return
        # Acceptance is not proof of group delivery; do not blindly retry ambiguous timeouts.
        # 接口受理不等于群消息送达；超时结果不明确时不盲目重试。
        post_report(url, token, report)
        accepted = {'day': day, 'acceptedAt': dt.datetime.now(BEIJING).isoformat(), **result}
        atomic_write(state_path, (json.dumps(accepted) + '\n').encode())
        print(json.dumps({'event': 'webhook_accepted', **accepted}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, NotifyError) else type(error).__name__
        print(json.dumps({'event': 'failed', 'error': code}), file=sys.stderr)
        sys.exit(1)
