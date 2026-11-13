#!/usr/bin/env python3
"""Push daily WeToken balances and one-shot threshold alerts to Feishu."""
import argparse
import copy
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
CHECK_INTERVAL_SECONDS = 300
BALANCE_THRESHOLDS = (100, 50)
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
    try:
        response = json.loads(body)
    except ValueError:
        raise NotifyError('WEBHOOK_RESPONSE_INVALID_DELIVERY_UNCONFIRMED')
    if not isinstance(response, dict) or type(response.get('code')) is not int:
        raise NotifyError('WEBHOOK_RESPONSE_INVALID_DELIVERY_UNCONFIRMED')
    if response['code'] != 0:
        raise NotifyError('WEBHOOK_REJECTED')


def atomic_write(path, content):
    temporary = path.with_suffix(path.suffix + '.new')
    with temporary.open('wb') as stream:
        stream.write(content)
    temporary.chmod(0o600)
    temporary.replace(path)


def save_state(path, state):
    atomic_write(path, (json.dumps(state) + '\n').encode())


def check_thresholds(report, state):
    if not report['available'] or report['stale']:
        return []
    alerts = state.setdefault('thresholdAlerts', {})
    # Only fresh recovery rearms each threshold; midnight does not reset alerts.
    # 仅实时余额恢复后重新布防，各档独立且不按天重置。
    for threshold in BALANCE_THRESHOLDS:
        if report['balance'] >= threshold:
            alerts.pop(str(threshold), None)
    return [threshold for threshold in BALANCE_THRESHOLDS
            if report['balance'] < threshold and str(threshold) not in alerts]


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
        'StartInterval': CHECK_INTERVAL_SECONDS,
        'StandardOutPath': str(ROOT / 'notify.log'),
        'StandardErrorPath': str(ROOT / 'notify-error.log'),
        'EnvironmentVariables': {'TZ': 'Asia/Shanghai'},
    }
    loaded = subprocess.run(['/bin/launchctl', 'print', domain + '/' + LABEL],
                            text=True, capture_output=True)
    if loaded.returncode == 0:
        if not target.is_file() or plistlib.loads(target.read_bytes()) != document:
            raise NotifyError('LOADED_NOTIFIER_DIFFERS_LEAVE_UNCHANGED')
        print(json.dumps({'event': 'already_loaded', 'schedule': '10:00 Asia/Shanghai',
                          'checkIntervalSeconds': CHECK_INTERVAL_SECONDS}))
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
    print(json.dumps({'event': 'installed', 'schedule': '10:00 Asia/Shanghai',
                      'checkIntervalSeconds': CHECK_INTERVAL_SECONDS}))


def notify(args, url, token):
    read_failed = False
    try:
        report = read_balance()
    except Exception:
        if args.dry_run:
            raise NotifyError('INTERNAL_BALANCE_READ_FAILED')
        read_failed = True
        report = None
    now = dt.datetime.now(BEIJING)
    day = now.date().isoformat()
    if read_failed:
        report = unavailable_report(now)
    result = {key: report[key] for key in ['available', 'balance', 'stale', 'updatedAt']}
    if args.dry_run:
        print(json.dumps({'event': 'dry_run', **result}))
        return
    state_path = ROOT / 'last-accepted.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    daily_due = args.send_now or (
        (now.hour, now.minute) >= (10, 0) and state.get('day') != day
        and state.get('pendingDaily', {}).get('day') != day)
    if read_failed and not daily_due:
        raise NotifyError('INTERNAL_BALANCE_READ_FAILED')
    previous_state = copy.deepcopy(state)
    thresholds = check_thresholds(report, state)
    if args.send_now and report['available'] and not report['stale']:
        thresholds = [threshold for threshold in BALANCE_THRESHOLDS if report['balance'] < threshold]
    if not daily_due and not thresholds:
        if state != previous_state:
            save_state(state_path, state)
        print(json.dumps({'event': 'not_due', 'day': day, **result}))
        return
    if thresholds:
        threshold = min(thresholds)
        reminder = ('余额严重不足，请立即充值，避免余额耗尽影响服务。' if threshold == 50
                    else '请尽快充值，确保服务正常使用。')
        report = {**report, 'message': 'WeToken 余额告警：低于 $' + str(threshold)
                  + ' USD\n' + reminder + '\n\n' + report['message']}
    pending = copy.deepcopy(state)
    if daily_due:
        pending['pendingDaily'] = {'day': day, 'attemptedAt': now.isoformat()}
    for threshold in thresholds:
        pending['thresholdAlerts'][str(threshold)] = {
            'status': 'pending', 'attemptedAt': now.isoformat(), 'balance': report['balance']}
    # Journal before sending so interrupted or ambiguous requests are not automatically repeated.
    # 先记录在途状态，避免请求中断或结果不明时被后续巡检重复发送。
    save_state(state_path, pending)
    try:
        post_report(url, token, report)
    except NotifyError as error:
        if str(error) in ('WEBHOOK_REJECTED', 'WEBHOOK_HTTP_400', 'WEBHOOK_HTTP_401',
                          'WEBHOOK_HTTP_403', 'WEBHOOK_HTTP_404', 'WEBHOOK_HTTP_405',
                          'WEBHOOK_HTTP_413', 'WEBHOOK_HTTP_415', 'WEBHOOK_HTTP_422',
                          'WEBHOOK_HTTP_429'):
            save_state(state_path, state)
        raise
    accepted = {'day': day, 'acceptedAt': dt.datetime.now(BEIJING).isoformat(), **result}
    if daily_due:
        state.update(accepted)
        state.pop('pendingDaily', None)
    for threshold in thresholds:
        state['thresholdAlerts'][str(threshold)] = {
            'status': 'accepted', 'acceptedAt': accepted['acceptedAt'], 'balance': report['balance']}
    save_state(state_path, state)
    print(json.dumps({'event': 'webhook_accepted', **accepted,
                      'daily': daily_due, 'thresholds': thresholds}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--dry-run', action='store_true', help='read balance without sending or changing state')
    modes.add_argument('--send-now', action='store_true', help='explicitly send a fresh report, bypassing deduplication')
    modes.add_argument('--install', action='store_true', help='register missing daily and 5-minute checks without stopping any job')
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
        notify(args, url, token)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, NotifyError) else type(error).__name__
        print(json.dumps({'event': 'failed', 'error': code}), file=sys.stderr)
        sys.exit(1)
