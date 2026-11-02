import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { isSupportCodePath, readSupportGit, supportCodeExclusions, supportGitRoot } from './code-search';
import { supportServices, type SupportServiceId } from './services';
import { nativeRuntimeVariable, readNativeRuntime } from './native-runtime';

export type SupportRuntimeSnapshot = {
  deploymentVersion: string;
  environment: 'development' | 'production';
  checkoutRevision?: string;
  workingTreeStamp?: string;
  capturedAt: string;
};

export type SupportCodeSource = {
  revision: string;
  mode: 'commit' | 'working-tree';
  verified: boolean;
  service?: SupportServiceId;
};

export type RuntimeResolution = { source: SupportCodeSource; evidence: Record<string, unknown>; verified: boolean };
const commitPattern = /^[a-f0-9]{40}$/;
const deploymentPattern = /^deploy-\d{8}T\d{6}Z-([a-f0-9]{12})$/;

async function checkoutRevision(root: string) {
  const revision = (await readSupportGit(['rev-parse', '--verify', 'HEAD^{commit}'], root)).trim();
  return commitPattern.test(revision) ? revision : undefined;
}

async function workingTreeStamp(root: string) {
  const listed = await readSupportGit([
    'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.', ...supportCodeExclusions,
  ], root);
  const paths = [...new Set(listed.split('\0').filter(isSupportCodePath))].sort();
  if (!paths.length || paths.length > 50_000) return undefined;
  const deadline = Date.now() + 8_000;
  const records: string[] = [];
  for (let offset = 0; offset < paths.length; offset += 64) {
    if (Date.now() > deadline) return undefined;
    const batch = await Promise.all(paths.slice(offset, offset + 64).map(async path => {
      const absolute = join(root, path);
      try {
        // Metadata includes ctime/mtime at nanosecond precision, so same-size edits also invalidate the stamp.
        // 纳秒精度的 ctime/mtime 也纳入戳，等长修改同样会失效；不读取任何源码或凭据内容。
        const stat = await lstat(absolute, { bigint: true });
        if (!stat.isFile() || await realpath(absolute) !== absolute) return `${path}\0unreadable`;
        return `${path}\0${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return `${path}\0missing`;
        throw error;
      }
    }));
    records.push(...batch);
  }
  if (!records.some(record => !record.endsWith('\0missing') && !record.endsWith('\0unreadable'))) return undefined;
  return createHash('sha256').update(root).update('\0').update(records.join('\0')).digest('hex');
}

export async function captureSupportRuntime(): Promise<SupportRuntimeSnapshot> {
  const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const snapshot: SupportRuntimeSnapshot = {
    deploymentVersion: process.env.APP_DEPLOYMENT_VERSION?.trim() || (environment === 'development' ? 'dev' : 'unknown'),
    environment,
    capturedAt: new Date().toISOString(),
  };
  try {
    const root = await supportGitRoot();
    snapshot.checkoutRevision = await checkoutRevision(root);
    if (environment === 'development' && snapshot.checkoutRevision) {
      snapshot.workingTreeStamp = await workingTreeStamp(root);
      // Do not attest to a checkout that changed while the snapshot was being collected.
      // 采集期间 checkout 发生变化时不签认该快照。
      if (await checkoutRevision(root) !== snapshot.checkoutRevision) snapshot.workingTreeStamp = undefined;
    }
  } catch {
    // Source-less deployments are valid runtimes, but cannot provide verified source evidence.
    // 无源码部署仍可正常记录运行快照，只是无法提供已核验的源码证据。
  }
  return snapshot;
}

export async function resolveSupportRuntime(
  snapshot?: SupportRuntimeSnapshot,
  source: SupportServiceId = 'fg',
): Promise<RuntimeResolution> {
  if (source === 'production-lab') {
    const resolved = await resolveSupportRuntime(snapshot, 'fg');
    return { ...resolved, source: { ...resolved.source, service: source }, evidence: { ...resolved.evidence,
      requestedSource: source, description: `Production Lab 应用内模块（业务库独立）：${resolved.evidence.description}` } };
  }
  const worker = await captureSupportRuntime();
  if (source !== 'fg') {
    const reference: SupportCodeSource = { revision: worker.checkoutRevision || '',
      mode: worker.environment === 'development' ? 'working-tree' : 'commit', verified: false, service: source };
    const runtime = await readNativeRuntime(source);
    let reason = runtime.reason;
    if (runtime.commit) {
      try {
        const resolved = await resolveCommitSource(runtime.commit, source);
        if (resolved.available) {
          const development = runtime.environment === 'development' && worker.environment === 'development';
          // A dev process may predate a local commit; use the working tree only as an explicit reference.
          // 开发进程可早于本地提交；工作树始终仅为参考，不能借此签认实际运行源码。
          reference.revision = development ? worker.checkoutRevision || resolved.revision : resolved.revision;
          reference.mode = development ? 'working-tree' : 'commit';
        }
        reference.verified = resolved.available && runtime.identityVerified === true && runtime.environment === 'production' && runtime.dirty === false
          && !!runtime.buildVersion && !/^(dev|development|unknown)$/i.test(runtime.buildVersion);
        reason = !resolved.available ? 'native_runtime_source_missing' : reference.verified ? 'native_runtime_commit_resolved'
          : runtime.environment === 'development' ? 'native_runtime_development_build' : runtime.dirty !== false ? 'native_runtime_dirty_or_unattested' : 'native_runtime_build_unattested';
      } catch { reason = 'native_runtime_source_unavailable'; }
    }
    const descriptions: Record<string, string> = {
      native_runtime_url_not_configured: `未配置 ${nativeRuntimeVariable(source)}`,
      native_runtime_service_mismatch: '版本接口服务身份与目标服务不符',
      native_runtime_commit_missing: '版本接口未提供有效部署提交',
      native_runtime_commit_resolved: '已核对服务身份、生产构建、clean 状态及对应提交源码',
      native_runtime_development_build: '开发进程已接通；提交仅为基线，不能证明正在运行的未提交修改',
      native_runtime_dirty_or_unattested: '构建含修改或未证明 clean 状态，不能仅凭提交签认运行源码',
      native_runtime_source_missing: '对应部署提交缺少该服务源码',
      native_runtime_source_unavailable: '部署提交或源码在本地不可用',
      native_runtime_build_unattested: '版本接口缺少完整生产构建证明',
    };
    return { source: reference, verified: reference.verified, evidence: { requestedSource: source,
      status: reference.verified ? 'verified' : reason === 'native_runtime_service_mismatch' ? 'mismatch' : 'unknown',
      ...reference, nativeRuntime: runtime, referenceOnly: !reference.verified, reason,
      description: `${supportServices[source].label}：${descriptions[reason] || '独立版本接口不可用或响应不符合安全合同'}；运行提交 ${runtime.commit?.slice(0, 12) || '未知'}；${reference.verified ? '已核对部署源码' : '源码仅供参考，不套用 FG 或 Canvas 的版本'}。` } };
  }
  let referenceRevision = worker.checkoutRevision || '';
  const mode: SupportCodeSource['mode'] = snapshot?.environment === 'development' && worker.environment === 'development'
    ? 'working-tree' : 'commit';
  const result = (status: 'verified' | 'unknown' | 'mismatch', reason: string, revision = referenceRevision): RuntimeResolution => {
    const verified = status === 'verified';
    return {
      source: { revision, mode, verified, service: source },
      verified,
      evidence: {
        status, reason,
        description: describeRuntime(snapshot, worker, status, reason, revision),
        requestedSource: source, snapshot: snapshot ?? null, worker,
        revision, mode, verified, referenceOnly: !verified,
        ...(verified ? {} : { warning: '源码仅供参考，不能视为实际运行版本的实现。' }),
      },
    };
  };
  if (!snapshot) return result('unknown', 'runtime_snapshot_missing');
  if (snapshot.environment === 'development') {
    if (worker.environment !== 'development') return result('mismatch', 'runtime_environment_mismatch');
    if (!snapshot.checkoutRevision || !worker.checkoutRevision || !snapshot.workingTreeStamp || !worker.workingTreeStamp) {
      return result('unknown', 'checkout_or_working_tree_stamp_missing');
    }
    if (snapshot.checkoutRevision !== worker.checkoutRevision) return result('mismatch', 'checkout_revision_mismatch');
    if (snapshot.workingTreeStamp !== worker.workingTreeStamp) return result('mismatch', 'working_tree_stamp_mismatch');
    return result('verified', 'development_checkout_and_working_tree_match');
  }
  if (snapshot.environment !== 'production') return result('unknown', 'runtime_environment_unknown');
  if (!snapshot.deploymentVersion || snapshot.deploymentVersion === 'unknown') return result('unknown', 'deployment_version_missing');
  // auto-deploy.sh emits deploy-<UTC timestamp>-<12-character commit>; HEAD is never a deployment identity.
  // auto-deploy.sh 使用 UTC 时间戳与 12 位提交号，绝不将 HEAD 当作部署版本。
  const deployedCommit = deploymentPattern.exec(snapshot.deploymentVersion)?.[1];
  if (!deployedCommit) return result('unknown', 'deployment_version_unrecognized');
  try {
    const resolved = await resolveCommitSource(deployedCommit);
    if (!resolved.revision.startsWith(deployedCommit)) return result('mismatch', 'deployment_commit_mismatch');
    referenceRevision = resolved.revision;
    if (!resolved.available) return result('unknown', 'deployment_source_missing');
    return result('verified', 'deployment_version_resolved_to_commit');
  } catch {
    return result('unknown', 'deployment_commit_or_source_unavailable');
  }
}

async function resolveCommitSource(commit: string, service?: SupportServiceId) {
  const root = await supportGitRoot();
  const revision = (await readSupportGit(['rev-parse', '--verify', `${commit}^{commit}`], root)).trim();
  if (!commitPattern.test(revision) || !revision.startsWith(commit)) throw new Error('运行提交无法匹配');
  const entries = await readSupportGit(['ls-tree', '-r', '-z', revision], root);
  const hasSource = entries.split('\0').some(entry => {
    const separator = entry.indexOf('\t');
    const path = entry.slice(separator + 1);
    return /^100(?:644|755) blob [a-f0-9]{40}$/.test(entry.slice(0, separator))
      && isSupportCodePath(path) && (!service || supportServices[service].paths.some(prefix => path.startsWith(prefix)));
  });
  if (!hasSource) return { revision, available: false };
  // Check object availability locally without fetching a partial clone's missing source.
  // 只检查本地对象完整性，不为 partial clone 缺失的源码联网拉取。
  const objects = await readSupportGit(['rev-list', '--objects', '--no-object-names', '--missing=print', `${revision}^{tree}`], root);
  return { revision, available: !objects.split('\n').some(object => object.startsWith('?')) };
}

function describeRuntime(
  snapshot: SupportRuntimeSnapshot | undefined, worker: SupportRuntimeSnapshot,
  status: 'verified' | 'unknown' | 'mismatch', reason: string, revision: string,
) {
  const reasons: Record<string, string> = {
    runtime_snapshot_missing: '缺少 API 入队时的运行快照',
    runtime_environment_mismatch: '入队与 worker 的运行环境不一致',
    checkout_or_working_tree_stamp_missing: '缺少 checkout 或工作树戳，无法核对',
    checkout_revision_mismatch: '入队与当前 checkout 不一致',
    working_tree_stamp_mismatch: '入队后工作树已变化',
    development_checkout_and_working_tree_match: '开发环境、checkout 与工作树戳均一致',
    runtime_environment_unknown: '无法识别入队时的运行环境',
    deployment_version_missing: '缺少入队时的部署版本',
    deployment_version_unrecognized: '部署版本格式无法解析为 Git 提交',
    deployment_commit_mismatch: '部署版本与 Git 提交不匹配',
    deployment_source_missing: '部署提交的源码缺失或不完整',
    deployment_version_resolved_to_commit: '已按入队时的部署版本核对提交及源码',
    deployment_commit_or_source_unavailable: '部署提交或对应源码不可用',
  };
  const running = `FG ${snapshot?.environment === 'development' ? '开发态' : '运行版本'} ${snapshot?.deploymentVersion?.slice(0, 100) || '未知'}`;
  const checkout = `当前 checkout ${worker.checkoutRevision?.slice(0, 12) || '不可用'}`;
  const checked = status === 'verified' ? `已核对源码 ${revision.slice(0, 12)}`
    : `${status === 'mismatch' ? '不匹配' : '未知'}，源码仅供参考`;
  return `${running}；${checkout}；${reasons[reason] || '运行版本无法核对'}；${checked}。`;
}
