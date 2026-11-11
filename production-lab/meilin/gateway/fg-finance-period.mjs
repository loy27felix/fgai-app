import {monthRange} from './fg-budgets.mjs';
export function financePeriod(month='all'){
 return month==='all'?{month:'all',since:null,until:null,timeZone:'Asia/Shanghai'}:{...monthRange(month),timeZone:'Asia/Shanghai'};
}
export function inFinancePeriod(value,period){
 if(period.month==='all')return true;
 const time=Date.parse(value);return Number.isFinite(time)&&time>=Date.parse(period.since)&&time<Date.parse(period.until);
}
