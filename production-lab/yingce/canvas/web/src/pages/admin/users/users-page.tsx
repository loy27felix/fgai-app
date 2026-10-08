import { AdminPageFrame } from "../components/admin-shell";
import { useAdminContext } from "../admin-context";
import UsersPanel from "./users-panel";
import {MonthlyBudgets} from './monthly-budgets';
import { Segmented } from 'antd';
import { useState } from 'react';

export default function UsersPage() {
    const { updateUserReference } = useAdminContext();
    const [panel, setPanel] = useState('accounts');
    return (
        <AdminPageFrame title="用户管理" description="账号、角色与状态">
            <Segmented className="self-start mb-4" value={panel} onChange={setPanel} options={[{value:'accounts',label:'账号管理'},{value:'budgets',label:'每月制作额度'}]} />
            {panel === 'accounts' ? <UsersPanel onUserChanged={updateUserReference} /> : <div className="min-h-0 flex-1 overflow-auto"><MonthlyBudgets/></div>}
        </AdminPageFrame>
    );
}
