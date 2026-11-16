// Docker SMB disk statistics can be invalid. Replace only that health reason
// when the mounted NAS has a fresh, internally consistent host snapshot.
export function applyHostDiskMetrics(data, snapshot, now = Date.now()) {
  const age = now - Date.parse(snapshot?.collectedAt);
  const valid = age >= 0 && age < 180000 && snapshot.totalBytes > 0 &&
    snapshot.usedBytes >= 0 && snapshot.usedBytes <= snapshot.totalBytes &&
    snapshot.freeBytes >= 0 && snapshot.freeBytes <= snapshot.totalBytes;
  const reasons = Array.isArray(data.degradedReasons) ? data.degradedReasons : null;
  if (valid) {
    data.disk = {...data.disk,...snapshot,available:true,
      usagePercent:snapshot.usedBytes/snapshot.totalBytes*100,source:'macos-df-nas'};
    if (reasons) {
      data.degradedReasons = reasons.filter(reason => reason !== 'diskMetrics');
      data.status = data.degradedReasons.length ? 'degraded' : 'healthy';
    }
  } else {
    data.disk = {...data.disk,available:false,totalBytes:0,usedBytes:0,freeBytes:0,usagePercent:0,
      statusMessage:'NAS 主机采集快照不可用；Docker SMB 指标不能作为容量依据'};
    data.degradedReasons = [...new Set([...(reasons || []),'diskMetrics'])];
    data.status = 'degraded';
  }
  return data;
}
