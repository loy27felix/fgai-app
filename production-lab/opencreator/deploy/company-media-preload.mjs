import {companyMediaFetch} from './company-media.mjs';

// The daemon is a separate Node process; bootstrap's global fetch cannot reach it.
const actor=process.env.FG_CREATOR_ACTOR;
const capability=process.env.FG_CREATOR_CAPABILITY;
if(!capability||!/^[0-9a-f-]{36}$/.test(actor||''))throw Error('FG creator identity missing');
globalThis.fetch=companyMediaFetch(globalThis.fetch,`http://fg-gateway:3010/internal/creator/${actor}`,capability);
