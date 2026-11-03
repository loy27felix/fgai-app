import {expect,test} from "bun:test";
import tools from "../../backend/internal/tools/seed/tools.json";
test("multi-camera nine-grid covers eight azimuths plus a face detail",()=>{
 const tool=JSON.stringify(tools);
 for(const direction of ["Front 0°","Front-right 45°","Right profile 90°","Rear-right 135°","Back 180°","Rear-left 225°","Left profile 270°","Front-left 315°","Face close-up"])expect(tool).toContain(direction);
});
