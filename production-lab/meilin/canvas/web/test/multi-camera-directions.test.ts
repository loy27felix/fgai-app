import {describe, expect,test} from "bun:test";
import tools from "../../backend/internal/tools/seed/tools.json";
const preset=tools.nine_grid.list.find(tool=>tool.id===79)!;
describe("multi-camera nine-grid reference scope",()=>{
 test("an environment reference keeps the whole scene instead of extracting its smallest character",()=>{
  expect(preset.label_en).toBe("multi_camera_nine_grid");
  expect(preset.prompt).toContain("SCENE / ENVIRONMENT REFERENCE");
  expect(preset.prompt).toContain("entire depicted environment is the subject");
  expect(preset.prompt).toContain("kitchen containing a small face-like screen");
  expect(preset.prompt).toContain("Do not extract that screen");
  expect(preset.prompt).toContain("same physical room");
  expect(preset.prompt).toContain("Never replace a scene with a neutral studio background");
  expect(preset.ratio).toBe("original");
 });
 test("eight azimuths and genuine rear views remain available for a character reference",()=>{
  expect(preset.prompt).toContain("CHARACTER / PRODUCT REFERENCE");
  for(const direction of ["Front 0°","Front-right 45°","Right profile 90°","Rear-right 135°","Back 180°","Rear-left 225°","Left profile 270°","Front-left 315°","Face close-up"])expect(preset.prompt).toContain(direction);
  expect(preset.prompt).toContain("NO frontal face and NO looking back");
  expect(preset.prompt).toContain("not just the background");
 });
});
