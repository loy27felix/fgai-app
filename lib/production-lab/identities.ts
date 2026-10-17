import { teamSelectedTopics } from "./selected-topics";
import { userDisplayName } from "@/lib/auth/user-display-name";

const knownNames = new Map<string, string>([
  ["zixuhan@beva.com", "韩子续"],
]);
const selectedTopicNames = new Map(teamSelectedTopics.map((topic) => [topic.selected_by_email.toLowerCase(), topic.selected_by]));

export function productionLabDisplayName(email: string): string {
  const normalized = email.trim().toLowerCase();
  const name = userDisplayName(email);
  return name !== email.split("@")[0] ? name : knownNames.get(normalized) || selectedTopicNames.get(normalized) || name;
}
