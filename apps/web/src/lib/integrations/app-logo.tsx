// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// An app's logo, from the best source there is, with the first letter only as a last resort:
//   1. the logo the app's catalog entry carries (the connected-apps service's logo for it),
//   2. a brand mark bundled with Gente (common apps; no request at all),
//   3. the favicon of the app's site, fetched through Gente's server only while it is on screen.
import { useLinkFavicon } from "@rakazo/chat-ui/web";
import { LogoTile } from "@rakazo/ui-web/logo-tile";
import { useMemo } from "react";
import { APP_LOGO_ICONS } from "./app-logo-icons";

/** The site of common apps, for their favicon when nothing else has a logo. */
const APP_SITES: Readonly<Record<string, string>> = {
  slack: "slack.com",
  salesforce: "salesforce.com",
  pipedrive: "pipedrive.com",
  monday: "monday.com",
  mondaycom: "monday.com",
  twilio: "twilio.com",
  linkedin: "linkedin.com",
  canva: "canva.com",
  microsoftteams: "teams.microsoft.com",
  outlook: "outlook.com",
  microsoftoutlook: "outlook.com",
  onedrive: "onedrive.live.com",
  excel: "office.com",
  microsoftexcel: "office.com",
  microsoftword: "office.com",
  gemini: "gemini.google.com",
  openai: "openai.com",
  amazonwebservices: "aws.amazon.com",
  aws: "aws.amazon.com",
  heroku: "heroku.com",
  freshdesk: "freshdesk.com",
  sendgrid: "sendgrid.com",
  klaviyo: "klaviyo.com",
  activecampaign: "activecampaign.com",
  gong: "gong.io",
  attio: "attio.com",
  close: "close.com",
  apollo: "apollo.io",
  apolloio: "apollo.io",
  harvest: "getharvest.com",
  smartsheet: "smartsheet.com",
  productboard: "productboard.com",
  front: "front.com",
  docusign: "docusign.com",
  yahoomail: "mail.yahoo.com",
  eventbrite: "eventbrite.com",
  amazon: "amazon.com",
  googlecalendar: "calendar.google.com",
  gmail: "mail.google.com",
  googledrive: "drive.google.com",
  googlesheets: "sheets.google.com",
  googledocs: "docs.google.com",
  notion: "notion.so",
  hubspot: "hubspot.com",
  shopify: "shopify.com",
  github: "github.com",
  figma: "figma.com",
  discord: "discord.com",
  zoom: "zoom.us",
  dropbox: "dropbox.com",
  stripe: "stripe.com",
};

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function bundledLogo(lookup: string): string | null {
  const icon = APP_LOGO_ICONS[lookup];
  if (!icon) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#${icon.hex}" d="${icon.path}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function AppLogo({
  name,
  logo,
  slug,
  site,
  size = 36,
  shape,
}: {
  name: string;
  logo?: string | null;
  /** The app's id in the connected-apps catalog. */
  slug?: string | null;
  /** The app's own website, when known. */
  site?: string | null;
  size?: number;
  shape?: "rounded" | "round";
}) {
  const lookup = key(slug || name);
  const nameKey = key(name);
  const appSite = site || APP_SITES[lookup] || APP_SITES[nameKey] || "";
  const favicon = useLinkFavicon(appSite ? `https://${appSite.replace(/^https?:\/\//, "")}` : "");
  const sources = useMemo(
    () =>
      [logo, bundledLogo(lookup) ?? bundledLogo(nameKey), favicon.icon].filter(
        (source, index, all): source is string => Boolean(source) && all.indexOf(source) === index,
      ),
    [logo, lookup, nameKey, favicon.icon],
  );
  return <LogoTile name={name} sources={sources} size={size} shape={shape} />;
}
