import { supportCanvasUser, withSupportCanvasReadOnly } from './operations';
import { redactSupportText } from './redact';

export const SUPPORT_CANVAS_ASSET_TABLES = ['assets', 'project_asset_links', 'asset_versions', 'asset_representations', 'resources', 'shot_asset_references', 'shots'] as const;
type AssetQuery = { userId: string; projectId?: string; assetId?: string; versionId?: string; category?: string; offset?: number; versionOffset?: number };
const identifier = /^[A-Za-z0-9_.:-]{1,120}$/;

export async function queryCanvasAssets(input: AssetQuery): Promise<Record<string, unknown>> {
  const envelope = { system: 'canvas', scope: { projectId: input.projectId, assetId: input.assetId, versionId: input.versionId, category: input.category, offset: input.offset ?? 0, versionOffset: input.versionOffset ?? 0, snapshot: true } };
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.userId) || !input.projectId
    || [input.projectId, input.assetId, input.versionId].some(id => id !== undefined && (!identifier.test(id) || redactSupportText(id) !== id))) {
    return { ...envelope, rows: [], incomplete: true, note: '素材查询需要有效的当前项目编号；未扩大到账号全部素材。' };
  }
  const offset = input.offset ?? 0;
  const versionOffset = input.versionOffset ?? 0;
  if (!Number.isInteger(versionOffset) || versionOffset < 0 || versionOffset > 1000 || (versionOffset > 0 && (!input.assetId || input.versionId))
    || !Number.isInteger(offset) || offset < 0 || offset > 1000 || (input.category !== undefined
    && !['character', 'environment', 'prop', 'material', 'other', 'wardrobe', 'weapon', 'accessory', 'style'].includes(input.category))) {
    return { ...envelope, rows: [], incomplete: true, note: '素材分类或分页参数无效，未忽略筛选条件。' };
  }
  try {
    return await withSupportCanvasReadOnly(async client => {
      const privileges = await client.query<{ name: string; readable: boolean }>(`SELECT name,
        coalesce(has_table_privilege(current_user, to_regclass('public.' || name), 'SELECT'), false) AS readable
        FROM unnest($1::text[]) AS name`, [[...SUPPORT_CANVAS_ASSET_TABLES]]);
      const missing = privileges.rows.filter(row => !row.readable).map(row => row.name);
      if (missing.length) return { ...envelope, rows: [], incomplete: true, missingSources: missing,
        note: `Canvas 素材取证缺表或缺 SELECT 权限：${missing.join(', ')}。这是助手的数据接入缺口，不代表用户素材丢失；需管理员补齐只读授权。` };
      const userId = await supportCanvasUser(client, input.userId);
      if (!userId) return { ...envelope, rows: [], incomplete: true, note: 'Canvas 当前账号的 active 受信映射不可用，未查询素材。' };
      // Keep snapshots separate from incident history; never read prompts, URLs or storage credentials.
      // 当前快照不冒充故障时刻的历史；只读本人项目及本人素材，不读取提示词、URL或存储凭据。
      const result = await client.query(`WITH scoped_assets AS (
        SELECT a.*, count(*) OVER () AS asset_count
          FROM assets a JOIN project_asset_links l ON l.asset_id = a.id
          JOIN projects p ON p.id = l.project_id AND p.user_id = $1 AND p.fg_deleted_at IS NULL
         WHERE l.project_id = $2 AND a.user_id = $1 AND ($3::text IS NULL OR a.id = $3)
           AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM asset_versions v WHERE v.asset_id = a.id AND v.id = $4))
           AND ($5::text IS NULL OR a.category = $5)
         ORDER BY a.updated_at DESC, a.id LIMIT 10 OFFSET $6
      ) SELECT coalesce(v.id, a.id) AS id, 'canvas_asset_snapshot' AS source, 'snapshot' AS "recordType",
          a.id AS "assetId", left(a.title, 120) AS "assetTitle", a.category,
          a.primary_version_id AS "primaryVersionId",
          EXISTS(SELECT 1 FROM asset_versions primary_version WHERE primary_version.id = a.primary_version_id AND primary_version.asset_id = a.id) AS "primaryVersionPresent",
          a.updated_at AS "assetUpdatedAt",
          a.asset_count::int AS "assetCount", v.id AS "versionId", v.version AS "versionNumber",
          v.status AS "versionStatus", coalesce(v.id = a.primary_version_id, false) AS "isPrimary",
          v.updated_at AS "versionUpdatedAt", coalesce(v.version_count, 0)::int AS "versionCount",
          coalesce(media.representations, '[]'::jsonb) AS representations,
          (SELECT count(*)::int FROM asset_representations r WHERE r.asset_version_id = v.id) AS "representationCount",
          (SELECT count(*)::int FROM asset_representations r WHERE r.asset_version_id = v.id AND r.role LIKE 'costume:%') AS "costumeCount",
          (SELECT count(*)::int FROM shot_asset_references ref JOIN shots s ON s.id = ref.shot_id AND s.project_id = $2
            WHERE ref.asset_version_id = v.id) AS "shotReferenceCount", current_timestamp AS "snapshotAt"
        FROM scoped_assets a
        LEFT JOIN LATERAL (
          SELECT av.*, count(*) OVER () AS version_count FROM asset_versions av
           WHERE av.asset_id = a.id AND ($4::text IS NULL OR av.id = $4)
           ORDER BY (av.id = a.primary_version_id) DESC, av.version DESC, av.id LIMIT 11 OFFSET $7
        ) v ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('id', r.id, 'role', r.role, 'mediaType', r.media_type,
            'resourceId', resource.id, 'resourceStatus', resource.status,
            'resourceVisible', resource.id IS NOT NULL, 'taskId', task.id, 'createdAt', r.created_at)
            ORDER BY r.created_at DESC, r.id) AS representations
          FROM (SELECT * FROM asset_representations WHERE asset_version_id = v.id ORDER BY created_at DESC, id LIMIT 11) r
          LEFT JOIN resources resource ON resource.id = r.resource_id AND resource.user_id = $1
          LEFT JOIN tasks task ON task.id = r.task_id AND task.user_id = $1
            AND (task.project_id = $2 OR task.project_id IN (
              SELECT id FROM canvas_projects WHERE project_id = $2 AND user_id = $1 AND deleted_at IS NULL))
        ) media ON true
       WHERE ($7::int = 0 OR v.id IS NOT NULL)
       ORDER BY (v.id = a.primary_version_id) DESC NULLS FIRST, a.updated_at DESC, a.id, v.version DESC, v.id LIMIT 111`,
      [userId, input.projectId, input.assetId ?? null, input.versionId ?? null, input.category ?? null, offset, versionOffset]);
      const assetIndex = [...new Map(result.rows.map(row => [row.assetId, {
        assetId: row.assetId, title: row.assetTitle, primaryVersionId: row.primaryVersionId,
        primaryVersionPresent: row.primaryVersionPresent, versionCount: row.versionCount,
      }])).values()];
      const rows = result.rows.slice(0, 30).map(row => ({ ...row,
        assetUpdatedAt: new Date(row.assetUpdatedAt).toISOString(),
        versionUpdatedAt: row.versionUpdatedAt ? new Date(row.versionUpdatedAt).toISOString() : null,
        snapshotAt: new Date(row.snapshotAt).toISOString(),
      }));
      const truncated = result.rows.length > 30 || rows.some(row => row.assetCount > offset + 10 || row.versionCount > versionOffset + 11 || row.representationCount > 11);
      return { ...envelope, rows, assetIndex, truncated,
        ...(input.assetId && rows.some(row => row.versionCount > versionOffset + 11) ? { nextVersionOffset: versionOffset + 11 } : {}), ...(rows.some(row => row.assetCount > offset + 10) ? { nextOffset: offset + 10 } : {}), coverage: { currentAssetBindings: true, historicalChanges: false, physicalFilesChecked: false },
        note: '仅为查询时本人项目中的素材、版本、服装图片绑定及分镜引用快照，不按故障时间过滤仍在使用的旧素材。resourceVisible=false 表示资源记录缺失或不属于当前用户，不等于文件被删除；资源记录存在也不证明物理文件可读。未读取历史变更或文件内容，不能据此断言何时、为何发生变化。每页最多10个素材（offset/nextOffset分页）、每素材11个版本（指定assetId后用versionOffset/nextVersionOffset分页）、每版本11个图片绑定，总计30个版本；assetIndex保留本页素材索引；截断时据此用 assetId/versionId 缩小查询。' };
    });
  } catch (error) {
    const denied = error && typeof error === 'object' && 'code' in error && error.code === '42501';
    return { ...envelope, rows: [], incomplete: true, note: denied
      ? 'Canvas 素材取证缺少 SELECT 权限，需要管理员补齐只读授权；未扩大权限或回退其他账号。'
      : 'Canvas 素材快照查询未完成，请核对数据库环境、结构及只读连接；未据此判断素材是否丢失。' };
  }
}
