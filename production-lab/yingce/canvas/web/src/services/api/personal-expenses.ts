import {http} from "./request";

export type PersonalExpenseRow={id:string;created_at:string;model:string;capability:string;status:string;project_name:string;channel_name:string;settled_cny:string|null;settled_reference_id:string|null};
export type PersonalModelExpense={model:string;requests:number;pending:number;settled_cny:string};
export type PersonalExpensesData={summary:{total_cny:string;month_cny:string;pending_requests:number;month_pending:number};currentMonth:string;models:PersonalModelExpense[];records:PersonalExpenseRow[];total:number};
export function getPersonalExpenses(filters:{month:string;model?:string;page:number},signal:AbortSignal){
    return http.get<PersonalExpensesData>("/fg/finance/mine",{params:{...filters,pageSize:20},signal});
}
