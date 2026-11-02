import test from 'node:test';
import assert from 'node:assert/strict';
import {retiredModulePath,retiredModuleResponse} from './fg-retired-modules.mjs';

test('removed modules reject old pages and APIs while shared production stays available',()=>{
 for(const path of ['/creator-app','/creator-static/app.js','/api/creator/jobs','/arcreel','/fg-director/','/internal/arcreel/member/archive','/referral','/admin/referral','/api/referral/commissions','/api/admin/settings/referral','/api/admin/referral/commissions'])assert.equal(retiredModulePath(path),true,path);
 for(const path of ['/projects','/drama-pipeline','/api/tasks','/advertising','/api/fg/speech/generate','/internal/creator/member/v1/audio/speech','/internal/adcraft/project','/meilin','/assets'])assert.equal(retiredModulePath(path),false,path);
 let status,body;retiredModuleResponse({writeHead(value){status=value;},end(value){body=JSON.parse(value);}});
 assert.equal(status,410);assert.equal(body.reason,'FG_MODULE_RETIRED');
});

test('credit operations retire independently of actual provider reconciliation',()=>{
 for(const path of ['/admin/payments','/admin/credit-operations','/admin/redemption-codes','/wallet','/api/payments/orders','/api/wallet/redeem','/api/admin/payments/orders','/api/admin/credit-adjustments','/api/admin/redemption-codes','/api/admin/redeem-batches/id/codes','/api/admin/billing-orders','/api/admin/users/id/credits/adjust','/api/admin/settings/credits'])assert.equal(retiredModulePath(path),true,path);
 for(const path of ['/my-expenses','/api/fg/finance/batch-matches','/api/fg/finance/request-decisions','/api/fg/budgets/users','/admin/fg-finance','/api/admin/api-logs/task/recover-media'])assert.equal(retiredModulePath(path),false,path);
});
