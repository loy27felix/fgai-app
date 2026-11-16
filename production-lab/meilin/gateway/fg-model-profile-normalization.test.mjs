import test from 'node:test';
import assert from 'node:assert/strict';
import {profileMatches} from './fg-model-profile-normalization.mjs';
test('native serialization may omit false and zero reference constraints',()=>{
 assert.ok(profileMatches({video:{references:{audioOnlySupported:false,minImageSide:0,minImageRatio:0,maxImageRatio:0}}},{video:{references:{}}}));
 assert.ok(!profileMatches({video:{references:{audioOnlySupported:true}}},{video:{references:{}}}));
 assert.ok(!profileMatches({video:{references:{minImageSide:400}}},{video:{references:{}}}));
});
test('unsupported quality may have native auto default without enabling quality',()=>{
 assert.ok(profileMatches({image:{quality:{supported:false,values:[],default:''}}},{image:{quality:{supported:false,values:[],default:'auto'}}}));
 assert.ok(!profileMatches({image:{quality:{supported:true,default:''}}},{image:{quality:{supported:true,default:'auto'}}}));
});
test('duration, dimensions and reference count remain exact',()=>{
 for(const field of ['maxImages','maxInputOutputDurationSeconds','maxImageSide'])assert.ok(!profileMatches({video:{references:{[field]:30}}},{video:{references:{[field]:15}}}));
 assert.ok(!profileMatches({video:{duration:{values:[2,30]}}},{video:{duration:{values:[2,15]}}}));
});
