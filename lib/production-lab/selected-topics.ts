export type TeamSelectedTopic = {
  id: number;
  title: string;
  original: string;
  plot: string;
  conflict: string;
  markets: string;
  tier: string;
  form: string;
  style: string;
  confidence: string;
  source_rights: string;
  source_name: string;
  blocked: false;
  selection_group: string;
  selected_by: string;
  selected_at: string;
};

const pending = "待补充；未从截图推断";

export const teamSelectedTopics: TeamSelectedTopic[] = [
  { id: 101, title: "春天临前不要爱上我", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组1", selected_by: "杨苏玉", selected_at: "9月20日 15:41" },
  { id: 102, title: "我的影子取代了我", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组1", selected_by: "罗香雪", selected_at: "9月20日 17:05" },
  { id: 103, title: "醒来之前，我已经过完一生", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组1", selected_by: "罗香雪", selected_at: "9月20日 17:06" },
  { id: 104, title: "被夺走人生后，她再次归来", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组1", selected_by: "杨苏玉", selected_at: "9月20日 17:08" },
  { id: 105, title: "他直到最后才认出我", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组1", selected_by: "吴怡萍", selected_at: "9月20日 17:11" },
  { id: 106, title: "醒来后，我的王国被继承了", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组1", selected_by: "吴怡萍", selected_at: "9月21日 11:02" },
  { id: 107, title: "失去声音以后，我要选择自己", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组2", selected_by: "刘润琪", selected_at: "9月22日 15:13" },
  { id: 108, title: "被女儿顶替的公主", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组2", selected_by: "刘润琪", selected_at: "9月22日 15:25" },
  { id: 109, title: "一只猫替我活了人生", original: pending, plot: "故事梗概待补充。", conflict: "故事梗概待补充；此处仅记录团队已选题。", markets: "待确认", tier: "已选题 · 待评档", form: "待确认", style: "待确认", confidence: "团队已选题；创作判断待补充", source_rights: "待核验", source_name: "内部选题记录", blocked: false, selection_group: "小组2", selected_by: "刘润琪", selected_at: "9月22日 16:04" },
];
