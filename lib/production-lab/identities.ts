import { teamSelectedTopics } from "./selected-topics";

const knownNames = new Map<string, string>([
  ["zixuhan@beva.com", "韩子续"],
]);
const selectedTopicNames = new Map(teamSelectedTopics.map((topic) => [topic.selected_by_email.toLowerCase(), topic.selected_by]));

export function productionLabDisplayName(email: string): string {
  const normalized = email.trim().toLowerCase();
  return knownNames.get(normalized) || selectedTopicNames.get(normalized) || email.split("@")[0] || email;
}
