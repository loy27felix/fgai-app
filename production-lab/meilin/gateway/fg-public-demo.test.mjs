import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPublicDemo,publicDemoDenied} from './fg-public-demo.mjs';
test('public sandbox cannot access company catalogues, external runtimes, sharing or credential writes',()=>{
 assert.ok(isPublicDemo({email:'test@beva.com'}));assert.ok(!isPublicDemo({email:'member@beva.com'}));
 for(const path of ['/api/fg/topics','/api/fg/projects','/api/fg/team','/api/fg/advertising','/api/fg-company-assets','/api/admin/users','/api/creator/app','/arcreel','/api/canvas/projects/a/share','/api/fg/meilin/dramas/a/share'])assert.ok(publicDemoDenied(new URL(path,'http://fg')),path);
 assert.ok(publicDemoDenied(new URL('/api/settings/personal-gpt','http://fg'),'PUT'));
 assert.ok(publicDemoDenied(new URL('/api/ai/models','http://fg'),'POST'));
 for(const path of ['/api/auth/session','/api/canvas/projects','/api/projects','/api/resources/access','/api/tasks','/api/fg/meilin/dramas','/api/fg/inspiration','/api/fg/models/quote'])assert.ok(!publicDemoDenied(new URL(path,'http://fg')),path);
});
