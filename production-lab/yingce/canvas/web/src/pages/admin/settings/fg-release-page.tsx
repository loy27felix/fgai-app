import { Alert, Button } from "antd";
import { AdminPageFrame } from "../components/admin-shell";

export default function FGReleasePage() {
    return (
        <AdminPageFrame title="FG 运行版本" description="第六板块由 FG 独立发布和维护。">
            <Alert type="info" showIcon title={`FG Studio · ${__APP_VERSION__}`} description="内部版本包含 FG 品牌、统一平台登录和 NAS 存储。更新由管理员在服务器发布，数据库和媒体保留；日常制作无需操作更新。" />
            <Button href="https://github.com/loy27felix/fgai-app/releases/tag/v1.2.1" target="_blank" rel="noopener noreferrer" style={{marginTop:16}}>打开 FG 1.2.1 更新说明</Button>
        </AdminPageFrame>
    );
}
