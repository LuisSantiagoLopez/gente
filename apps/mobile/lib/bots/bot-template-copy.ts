import { t } from "@lingui/core/macro";
import type { BotTemplate } from "@rakazo/contracts";

export type BotTemplateCopy = Pick<BotTemplate, "name" | "summary" | "sample">;

/**
 * Each template's name, summary and sample in the app's language. The English here must match
 * `BOT_TEMPLATES` (a test checks); a template without copy here shows the server's English.
 */
export function botTemplateCopy(template: BotTemplate): BotTemplateCopy {
  switch (template.id) {
    case "morning-briefing":
      return {
        name: t`Morning briefing`,
        summary: t`Your day at a glance, every weekday morning`,
        sample: t`**Thursday**

**Calendar**
- 10:00 Design review, moved to 11:30
- 14:00 Call with Dana

**Needs you**
- Alex asked for the Q4 numbers by noon
- A contract is waiting for your signature

**Worth knowing**
- Light rain after 4pm
- Two stories on the topics you follow`,
      };
    case "inbox-triage":
      return {
        name: t`Inbox triage`,
        summary: t`Sorts new email and drafts the replies`,
        sample: t`**12 new since 8:00**

**Reply needed**
1. Priya wants to move Friday's review. Draft: "Friday works if we start at 2."
2. Your card expires on the 30th. Draft ready.
3. Sam asked about the API limits. Draft ready.

**For your information**: a shipping update and a calendar change

**Low priority**: 7 newsletters and notifications`,
      };
    case "pr-reviewer":
      return {
        name: t`PR reviewer`,
        summary: t`Reviews pull requests waiting on you`,
        sample: t`**2 pull requests are waiting on you**

**#482 Add retry to webhook delivery**
- Retries on 404 too, so a deleted endpoint is retried five times. Retry only 5xx and timeouts?
- No test for the backoff cap.

Suggested review: request changes.

**#479 Fix date parsing in reports**
Looks good. Suggested review: approve.`,
      };
    case "topic-watch":
      return {
        name: t`Topic watch`,
        summary: t`A weekly digest of what changed on topics you follow`,
        sample: t`**This week**

**Open-source AI agents**
- A major release adds scheduled tasks (3 days ago)
- Two new comparisons; both call memory the main gap

**competitor.example**
- Pricing: the Team plan went from $20 to $25 per seat

Nothing new on battery recycling.`,
      };
    case "review-replies":
      return {
        name: t`Review replies`,
        summary: t`Drafts a reply to every new Google review`,
        sample: t`**3 new reviews this week**

1. ★★★★★ Marta: "Best haircut in years." Draft: "Thank you, Marta! See you next time."
2. ★★☆☆☆ Leo: "Waited 40 minutes." Draft: "Sorry for the wait, Leo. We've added a second chair on Saturdays."
3. ★★★★☆ Ana. Draft ready.

Approve to post, or edit any draft.`,
      };
    case "booking-desk":
      return {
        name: t`Booking desk`,
        summary: t`Answers booking and quote requests with your open times`,
        sample: t`**2 booking requests**

1. Jon wants a deep clean Thursday. Free: Thu 10:00 or 14:00. Draft ready.
2. Sofia asks the price for a 3-bedroom. Quote from your price list: $180. Draft ready.

Gmail drafts saved. Nothing booked until a client picks a time.`,
      };
    case "store-support":
      return {
        name: t`Store support`,
        summary: t`Drafts replies to customer emails using real order data`,
        sample: t`**4 customer emails**

1. #1042 Where is my order? Shipped Monday, arriving Thursday. Draft ready.
2. #1039 Wrong size. Exchange policy applies. Draft ready.
3. #1051 Refund request, $64.00. Needs your OK.
4. Wholesale question. Draft ready.`,
      };
    case "sales-digest":
      return {
        name: t`Sales digest`,
        summary: t`Yesterday's sales, refunds and low stock in one message`,
        sample: t`**Tuesday: $2,340 from 31 orders** (up 12% on last Tuesday)

- Best seller: Linen shirt, 9 sold
- Refunds: 1, $48
- Low stock: Linen shirt (4 left), Canvas tote (2 left)

Added to your Sales sheet, row 212.`,
      };
    case "listing-writer":
      return {
        name: t`Listing writer`,
        summary: t`Turns product notes into ready listings with titles and tags`,
        sample: t`**Listing draft: Hand-thrown mug, speckled glaze**

Title: Speckled Ceramic Mug, 12 oz, Handmade Stoneware Coffee Cup
Tags: handmade mug, ceramic, stoneware, coffee lover gift, speckled
Description: 3 short paragraphs, care notes, size.

Saved as a draft product in your store. Not published.`,
      };
    case "proposal-writer":
      return {
        name: t`Proposal writer`,
        summary: t`Turns a client inquiry into a proposal and a reply draft`,
        sample: t`**Proposal ready for Lumen Studio**

- Scope: new website, 6 pages, 3 weeks
- Price: $4,800 in two payments (from your rate card)
- Doc: Proposal - Lumen Studio (Google Docs)

Reply draft saved in Gmail with the link. Not sent.`,
      };
    case "invoice-chaser":
      return {
        name: t`Invoice chaser`,
        summary: t`Finds unpaid invoices and drafts polite reminders`,
        sample: t`**$6,250 overdue across 3 invoices**

1. Acme, $3,000, 12 days late. Second reminder drafted.
2. Lumen Studio, $2,400, 4 days late. Friendly nudge drafted.
3. Ode Cafe, $850, 31 days late. Firm reminder drafted.

3 Gmail drafts saved. Nothing sent.`,
      };
    case "deal-follow-up":
      return {
        name: t`Deal follow-up`,
        summary: t`Finds stalled deals and drafts the next email`,
        sample: t`**5 deals need a nudge**

1. Northwind, $12k, no reply in 9 days. Follow-up drafted.
2. Bluebird, $4k, demo done Tuesday. Recap drafted.
3. Kite Labs, $30k, contract sent 6 days ago. Check-in drafted.

Notes logged on each deal in your CRM.`,
      };
    case "meeting-prep":
      return {
        name: t`Meeting prep`,
        summary: t`A one-page brief before every client or sales call`,
        sample: t`**Tomorrow 10:00: Kite Labs (Dana Ruiz, VP Ops)**

- Deal: $30k, contract sent last week
- Last email: asked about onboarding time
- News: Kite Labs raised a Series A on Monday
- Ask: who signs, and by when?`,
      };
    case "lead-responder":
      return {
        name: t`Lead responder`,
        summary: t`Answers new property leads in minutes and books showings`,
        sample: t`**2 new leads**

1. Maya, 14 Oak St listing, pre-approved. Showing times offered: Sat 11:00 or Sun 15:00. Draft ready.
2. Chris, 'looking in Eastside under $600k'. 3 matching listings from your sheet. Draft ready.

Both added to your Leads sheet.`,
      };
    case "books-tidy":
      return {
        name: t`Books tidy-up`,
        summary: t`Sorts uncategorized transactions and lists missing receipts`,
        sample: t`**28 transactions to sort, 24 suggested**

- 18 software and ads, matched to past categories
- 6 meals and travel
- 4 unclear: listed below with questions

Missing receipts: 3. Reminder drafted to you.`,
      };
    case "content-repurposer":
      return {
        name: t`Content repurposer`,
        summary: t`Turns your latest video into posts for every channel`,
        sample: t`**From your video: '5 mistakes new runners make'**

- X thread: 6 posts
- LinkedIn post: 180 words
- Instagram caption with 8 hashtags
- 3 short clip ideas with timestamps

All saved to your Content calendar in Notion. Nothing posted.`,
      };
    case "client-report":
      return {
        name: t`Client report`,
        summary: t`A weekly marketing report per client, with a draft email`,
        sample: t`**Bluebird Bakery: week of 10 Nov**

- Visits 4,210 (+8%), orders from search 61 (+14%)
- Top page: Holiday cakes, 1,020 visits
- Search: 'custom cakes near me' moved from 9th to 4th
- Next: add a holiday FAQ page

Report doc and email draft saved.`,
      };
    case "candidate-outreach":
      return {
        name: t`Candidate outreach`,
        summary: t`Personal outreach drafts and interview times for your shortlist`,
        sample: t`**Senior designer role: 6 candidates**

- 4 outreach drafts, each naming one thing from their portfolio
- 2 replied yes: interview times offered (Tue 11:00, Wed 15:00)

Pipeline sheet updated. Nothing sent.`,
      };
    case "job-hunt":
      return {
        name: t`Job hunt`,
        summary: t`Finds fitting jobs, tailors your CV, and tracks applications`,
        sample: t`**5 new jobs that fit**

1. Product Designer, Lumen (remote, $120-140k). Cover letter drafted.
2. UX Lead, Kite Labs (NYC). CV tailored: Kite Labs CV (Docs).
3. Follow-up due: Northwind, applied 8 days ago. Draft ready.

Tracker sheet updated.`,
      };
    case "meeting-notes":
      return {
        name: t`Meeting notes`,
        summary: t`Notes, decisions and follow-ups from every call, kept on your computer`,
        sample: t`**Bluebird Bakery check-in, Thu 10:00**

**Decisions**
- Online ordering goes ahead on the store app

**Action items**
- You: send the setup quote by Friday
- You: share the analytics report on Monday

**Open**: delivery zones at launch or January?

Recap email drafted. Next check-in Thu 10:00 waits for your OK.`,
      };
    default:
      return template;
  }
}
