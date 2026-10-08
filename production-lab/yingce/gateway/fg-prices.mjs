// Rate estimates are separate from fee reconciliation. Unknown usage, cache
// pricing, modality or resolution must remain null, never a fabricated zero.
// Observed Seedance receipts round positive charges up to 6 currency decimals.
// This remains an estimate; only the provider receipt can settle the charge.
export function estimateCNY(call,price,fx){
    const usd=estimateUSD(call,price);
    if(usd===null)return null;
    const rounded=String(call.model).includes('seedance')?Math.ceil(usd*1e6-1e-8)/1e6:usd;
    return rounded*fx;
}
export function estimateUSD(call,price){
    if(!price?.enabled||!Number.isFinite(price.discount)||call.status!=='succeeded'||call.task_status==='failed')return null;
    const discount=price.discount;
    let request,response;try{request=JSON.parse(call.request_body||'{}');response=JSON.parse(call.response_body||'{}');}catch{return null;}
    if(call.capability==='image'&&String(call.model).startsWith('gpt-image-')&&response.usage){
        const u=response.usage,details=u.input_tokens_details,out=u.output_tokens_details;
        const counts={textInput:details?.text_tokens,imageInput:details?.image_tokens,imageOutput:out?.image_tokens,textOutput:out?.text_tokens};
        const rules=price.pricing_rules?.rules||[];
        const labels={textInput:['Text','Input'],imageInput:['Image','Input'],imageOutput:['Image','Output'],textOutput:['Text','Output']};
        let amount=0;
        for(const [key,[modality,type]] of Object.entries(labels)){
            const count=counts[key];if(!Number.isFinite(count)||count<0)return null;
            if(count===0)continue;
            const rate=rules.find(r=>r.modality===modality&&r.token_type===type)?.price;
            if(!Number.isFinite(rate))return null;
            amount+=count*rate/1e6;
        }
        return amount*discount;
    }
    if(call.capability==='video'&&String(call.model).includes('seedance')&&call.usage_available&&Number(call.output_tokens)>0){
        // Final polling usage already includes reference input / minimum usage.
        // Never reconstruct actual video tokens from rounded integer seconds.
        const scenario=request.content?.some(x=>x.type==='video_url')?'with_video_input':'without_video_input';
        const resolution=String(request.resolution||response.resolution||'').toLowerCase();
        const rate=price.pricing_rules?.rules?.find(r=>r.scenario===scenario&&String(r.resolution).toLowerCase().split('/').includes(resolution))?.price;
        return Number.isFinite(rate)?Number(call.output_tokens)*rate/1e6*discount:null;
    }
    if(call.capability==='image'&&String(call.model).startsWith('dola-seedream')){
        const size=String(request.size||'').match(/^(\d+)x(\d+)$/),generated=Number(response.usage?.generated_images),input=Number(response.usage?.input_images);
        if(!size||!(generated>0)||!Number.isFinite(input))return null;
        return (generated*(Number(size[1])*Number(size[2])<2360000?.045:.09)+input*.003)*discount;
    }
    if(call.capability==='text'&&call.usage_available){
        const input=Number(call.input_tokens),output=Number(call.output_tokens),cached=Number(call.cached_tokens||0);
        if(![input,output,cached].every(n=>Number.isFinite(n)&&n>=0)||cached>input)return null;
        const tier=price.tiered_pricing?.find(t=>(t.max_input_tokens===-1||input<=t.max_input_tokens)&&(t.max_output_tokens===-1||output<=t.max_output_tokens));
        const rule=price.pricing_rules;
        const inp=tier?.input_price_per_m??(rule?.currency==='USD'?rule?.input_price:undefined);
        const out=tier?.output_price_per_m??(rule?.currency==='USD'?rule?.output_price:undefined);
        const cache=tier?.cached_price_per_m;
        if(!Number.isFinite(inp)||!Number.isFinite(out)||(cached>0&&!Number.isFinite(cache)))return null;
        return ((input-cached)*inp+output*out+cached*(cache||0))/1_000_000*discount;
    }
    if(call.capability==='image'&&price.quota_type===1&&Number.isFinite(price.model_price)&&call.media_count>0){
        if(price.priceConflict)return null;
        // Pixel tier / input-image surcharges need separate detailed usage.
        if(price.pricing_rules?.rules?.length)return null;
        return price.model_price*call.media_count*discount;
    }
    if(call.capability==='video'&&price.pricing_rules?.type==='per_second'&&price.pricing_rules.currency==='USD'){
        // Conflicting provider billing units cannot establish a safe estimate.
        if(price.billing_doc?.billing_unit&&price.billing_doc.billing_unit!=='per_second'&&price.verifiedBillingUnit!=='per_second')return null;
        let body;try{body=JSON.parse(call.request_body||'{}');}catch{return null;}
        const resolution=String(body.parameters?.resolution||body.resolution||'').toLowerCase();
        const rate=price.pricing_rules.rules?.find(r=>String(r.resolution||'').toLowerCase()===resolution)?.price??price.pricing_rules.default_price;
        const seconds=Number(call.video_seconds);
        return Number.isFinite(rate)&&seconds>0?rate*seconds*discount:null;
    }
    return null;
}
