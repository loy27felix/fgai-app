// Read-only company account validation. No generation, download or solver.
import {musicServiceSecret} from './fg-music-provider.mjs';
try{
 const response=await fetch('http://suno:3050/validate',{method:'POST',headers:{authorization:'Bearer '+musicServiceSecret()},signal:AbortSignal.timeout(90000)});
 const data=await response.json();
 if(!response.ok||data.accountReadable!==true)throw Error(/^SUNO_[A-Z_]+$/.test(data.error?.code)?data.error.code:'SUNO_VALIDATION_FAILED');
 console.log(JSON.stringify({accountReadable:true,creditsLeft:data.creditsLeft,model:data.model,models:data.models,captchaRequired:data.captchaRequired,checkedAt:data.checkedAt,generationVerified:false,paidRequests:0}));
}catch(error){console.log(JSON.stringify({accountReadable:false,code:/^SUNO_[A-Z_]+$/.test(error.message)?error.message:'SUNO_VALIDATION_FAILED',paidRequests:0}));process.exitCode=1;}
