// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/** An app people connect by name; `slug` is its connection catalog slug. */
export type WorkApp = { slug: string; name: string };

/**
 * The software people use to make money (mail, calendar, CRM, store, payments, books, social,
 * code), which Gente lists first and its recipes name. Any other catalog app still connects.
 */
export const WORK_APPS: readonly WorkApp[] = [
  { slug: "gmail", name: "Gmail" },
  { slug: "outlook", name: "Outlook" },
  { slug: "googlecalendar", name: "Google Calendar" },
  { slug: "googlesheets", name: "Google Sheets" },
  { slug: "googledrive", name: "Google Drive" },
  { slug: "googledocs", name: "Google Docs" },
  { slug: "notion", name: "Notion" },
  { slug: "slack", name: "Slack" },
  { slug: "hubspot", name: "HubSpot" },
  { slug: "salesforce", name: "Salesforce" },
  { slug: "pipedrive", name: "Pipedrive" },
  { slug: "shopify", name: "Shopify" },
  { slug: "stripe", name: "Stripe" },
  { slug: "square", name: "Square" },
  { slug: "quickbooks", name: "QuickBooks" },
  { slug: "xero", name: "Xero" },
  { slug: "linkedin", name: "LinkedIn" },
  { slug: "twitter", name: "X" },
  { slug: "instagram", name: "Instagram" },
  { slug: "youtube", name: "YouTube" },
  { slug: "tiktok", name: "TikTok" },
  { slug: "canva", name: "Canva" },
  { slug: "figma", name: "Figma" },
  { slug: "github", name: "GitHub" },
  { slug: "vercel", name: "Vercel" },
  { slug: "zoom", name: "Zoom" },
  { slug: "calendly", name: "Calendly" },
  { slug: "airtable", name: "Airtable" },
  { slug: "trello", name: "Trello" },
  { slug: "asana", name: "Asana" },
  { slug: "linear", name: "Linear" },
  { slug: "mailchimp", name: "Mailchimp" },
  { slug: "klaviyo", name: "Klaviyo" },
  { slug: "google_business_profile", name: "Google Business Profile" },
  { slug: "google_analytics", name: "Google Analytics" },
  { slug: "google_search_console", name: "Google Search Console" },
  { slug: "googleads", name: "Google Ads" },
  { slug: "metaads", name: "Meta Ads" },
  { slug: "jobber", name: "Jobber" },
  { slug: "typeform", name: "Typeform" },
  { slug: "docusign", name: "DocuSign" },
  { slug: "apollo", name: "Apollo" },
];

const WORK_APP_SLUGS = new Set(WORK_APPS.map((app) => app.slug));

export function isWorkApp(slug: string): boolean {
  return WORK_APP_SLUGS.has(slug);
}
