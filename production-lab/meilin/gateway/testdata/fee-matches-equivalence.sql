-- Isolated PostgreSQL fixture: run against both legacy and optimized views.
CREATE TABLE model_channels(id text PRIMARY KEY,name text);
CREATE TABLE api_call_logs(id text PRIMARY KEY,model text,billable boolean,channel_id text,fg_fee_reference_id text,fg_fee_references_json text,capability text,provider_request_id text);
CREATE TABLE fg_provider_fees(reference_id text PRIMARY KEY,model text);
CREATE TABLE fg_fee_decisions(reference_id text PRIMARY KEY,call_id text UNIQUE,classification text);
CREATE TABLE fg_fee_usage_matches(reference_id text PRIMARY KEY,call_id text UNIQUE);
INSERT INTO model_channels VALUES('wetoken','WeToken · Company'),('other','Other');
INSERT INTO api_call_logs SELECT 'call-'||n,'model-'||(n%4),true,'wetoken','ref-'||n,json_build_array('ref-'||n,'ref-'||n)::text,'image','' FROM generate_series(1,1000) n;
INSERT INTO fg_provider_fees SELECT 'ref-'||n,'model-'||(n%4) FROM generate_series(1,3000) n;
INSERT INTO api_call_logs VALUES
 ('ambiguous','model-1',true,'wetoken','ref-1','[]','image',''),
 ('numeric','edge',true,'wetoken','absent','[123,true,null,{"nested":"ignored"},"array-key"]','image',''),
 ('object','edge',true,'wetoken','absent','{"object-key":42}','image',''),
 ('scalar','edge',true,'wetoken','absent','"scalar-key"','image',''),
 ('video','model-2',true,'wetoken','ref-2','["ref-2"]','video','video-ref'),
 ('wrong-channel','model-3',true,'other','ref-3','[]','image',''),
 ('nonbillable','model-0',false,'wetoken','ref-4','[]','image',''),
 ('usage-only','edge',true,'wetoken','absent','[]','image',''),
 ('blank','edge',true,'wetoken','','[]','image','');
INSERT INTO fg_provider_fees VALUES('123','edge'),('true','edge'),('nested','edge'),('array-key','edge'),('object-key','edge'),('scalar-key','edge'),('video-ref','model-2'),('usage-ref','edge'),('manual-ref','model-1'),('','edge');
INSERT INTO fg_fee_usage_matches VALUES('usage-ref','usage-only'),('ref-3','call-3');
INSERT INTO fg_fee_decisions VALUES('manual-ref','call-5','matched'),('ref-6',NULL,'ignored');
