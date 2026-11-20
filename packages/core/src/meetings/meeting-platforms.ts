import type { MeetingPlatform } from "@rakazo/contracts";

export const meetingPlatformNames: Record<MeetingPlatform, string> = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  microsoft_teams: "Microsoft Teams",
};

/**
 * Gente: the name a meeting bot joins under. It always says it is an AI assistant and whose it
 * is, so nobody in the call takes it for the person. Platforms cap names near 100 characters.
 */
export function meetingBotName(ownerName: string | null | undefined): string {
  const first = ownerName?.trim().split(/\s+/)[0]?.slice(0, 60);
  return first ? `${first}'s Gente (AI assistant)` : "Gente (AI assistant)";
}
