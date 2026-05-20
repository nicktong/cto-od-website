/* ============================================================
   /api/prompts-data.js
   The prompt library content, served by /api/prompts only to
   clients with a valid token. Kept out of the static site so the
   /ai-brain/prompts/ page can be a true gate, not just a soft
   URL reveal.
   ============================================================ */

const SECTIONS = [
  { id: 'foundations',    label: 'Foundations',                 lead: 'Three files every Claude Project should have before you build anything else. Spend 30 minutes on these and the rest of the library works ten times better.' },
  { id: 'coach',          label: 'For coaches and consultants', lead: 'Three workflows I install for coaches in their first week. Each assumes you\'ve already done prompts 01 and 02.' },
  { id: 'small-business', label: 'For small business owners',   lead: 'Three workflows aimed at people running a business with their own hands. Less polish, more time back.' },
  { id: 'founder',        label: 'For founders',                lead: 'There\'s already founder content in <a href="/blog/why-founders-get-5-percent-from-ai/">Why 5%</a>, <a href="/blog/build-your-first-ai-agent-stack/">Build a Stack</a>, and <a href="/blog/ai-content-pipeline-founders/">Content Pipeline</a> with prompts inside those posts. This section is the one I get asked for most often.' }
];

const PROMPTS = [
  {
    id: 'p1', section: 'foundations', audience: 'Universal',
    title: 'The about-you brief',
    description: 'Use this once to draft an <code>about-you.md</code> file. Upload it to your Claude Project\'s knowledge base. From now on, every conversation in that project starts with Claude already knowing who you are.',
    prompt: `I want to create an about-you.md file for a Claude Project that I use to run
my work. Treat this as an interview, not a draft.

Ask me one question at a time, in this order:

1. What's your role in one sentence, including who you serve and what
   outcome you sell them.
2. What three workflows do you repeat most often in a typical week?
3. Who are the three to five recurring "characters" in your week (clients,
   collaborators, suppliers, your accountant, your co-founder)? Just their
   names, roles, and one line on how to handle each.
4. What do you NOT want Claude to help with? (Things outside your scope,
   or things you'd rather still do yourself.)
5. What are the two or three constraints I should always respect? (Budget,
   time-of-day, family commitments, accessibility, regulatory.)

After each answer, summarise it back in one line and confirm before moving on.

When all five are answered, produce the final about-you.md as a single
markdown document, with these sections:
- One-line role
- Weekly workflows
- People I work with
- Out of scope
- Constraints
- Last updated

Keep it under 350 words total. Tight is better than thorough.`,
    tip: '<strong>Tip.</strong> The first version won\'t be perfect. Run it once a month for the first three months and let Claude rewrite it from a fresh interview each time. After three iterations it will be sharp.'
  },
  {
    id: 'p2', section: 'foundations', audience: 'Universal',
    title: 'The style guardrails',
    description: 'A two-section file (<code>style.md</code>) that defines how you write and what you never write. Upload to the project; reference from every workflow prompt. The single biggest reason AI output sounds "off" is that this file doesn\'t exist.',
    prompt: `Help me build a style.md file for my Claude Project. The file has two sections:

## How I write
A short paragraph (3-4 sentences) capturing my voice. Cover:
- Sentence length and rhythm
- Tone (warm, direct, technical, conversational, formal)
- Vocabulary level (plain English, industry-specific, mixed)
- How I handle uncertainty (do I hedge, do I commit, do I show working)

## What I never write
A list of phrases, words, and patterns I want banned outright. Cover:
- Generic AI tells ("It's important to note", "delve into", "in the realm of",
  "leverage" as a verb, "elevate", "in the digital age")
- Filler openers ("In this article we'll explore", "Let's dive in")
- Hedging that adds nothing ("It may be worth considering", "perhaps you might")
- Punctuation habits I dislike (em-dashes, exclamation marks, semicolons —
  pick what's right for you)
- Any words or phrases specific to my industry that have become hollow

Process:
1. Ask me to paste three pieces of writing I'm proud of (an email, a post,
   a piece of client-facing copy).
2. Extract the voice signals from those samples — sentence length range,
   typical openers, recurring word choices.
3. Draft section one based on what you see.
4. Then ask me what makes me wince in AI output. Draft section two from
   my answers and from common AI-slop patterns.
5. Show me the final style.md.

Total length: under 400 words. Specific beats comprehensive.`,
    tip: '<strong>Tip.</strong> Once <code>style.md</code> exists, every workflow prompt in this library can end with one line: "Apply style.md." That single instruction does more work than any clever rewording.'
  },
  {
    id: 'p3', section: 'foundations', audience: 'Universal',
    title: 'Knowledge hygiene workflow',
    description: 'Run this once on every long document before you add it to a Claude Project\'s knowledge base. The output is smaller, tighter, and far more useful than the original.',
    prompt: `I'm about to add a long document to my Claude Project's knowledge base.
Before I do, I want to extract a tighter version that Claude can actually
use as reference material.

<document>
[paste the full text, or attach the file]
</document>

<purpose>
[one line on why I want this in the project — e.g. "so Claude can reference
my coaching framework when drafting session plans"]
</purpose>

Produce a structured reference document with these sections (skip any
section that doesn't apply):

1. Core principles — the rules or beliefs the document is built on (max 7)
2. Frameworks — any named models, processes, or step-by-step methods
3. Decision rules — if/then logic worth remembering ("when X, do Y")
4. Vocabulary — terms with specific meaning in this context
5. Out of scope — what this document explicitly does NOT cover
6. Source — original document title and date

Constraints:
- Under 800 words total
- Each section is bullets, not prose
- Skip examples and case studies unless they're load-bearing
- If something contradicts itself in the source, flag it; don't try to resolve

If the document is fewer than 1,000 words to begin with, tell me it's
probably small enough to upload as-is and skip the rest.`,
    tip: '<strong>Why this matters.</strong> Knowledge bases work better when they\'re sparse. Twenty pages of crisp reference material beats two hundred pages of meandering source.'
  },
  {
    id: 'p4', section: 'coach', audience: 'Coach',
    title: 'Session prep from notes',
    description: 'Drop yesterday\'s notes (or a transcript) in, and a short, structured prep brief comes out for tomorrow\'s session. The version I install for clients runs in under a minute and replaces about 15 minutes of "let me re-read this and gather myself before the call."',
    prompt: `You are helping me prep for a coaching session in the next hour.

<client-notes>
[paste the last session's notes, the client's latest message,
or a transcript]
</client-notes>

<goal>
[one line on what I want to achieve in this session]
</goal>

Use about-you.md for how I coach. Apply style.md.

Output, in this exact order:
1. Where we left off (3 bullets, max)
2. The one question I should open with
3. Two things the client said last time that they probably haven't done
4. One risk or watch-out for this session (a place they'll likely retreat
   to, a topic they'll avoid, a decision they're putting off)
5. A 2-sentence intention for me as the coach, in my own voice

Constraints:
- Under 200 words total
- No generic coaching advice (no "create a safe space," no "hold space")
- If anything's missing from the inputs, ask one clarifying question
  before drafting`,
    tip: '<strong>Iteration note.</strong> The first three or four times this runs, the "risk or watch-out" section will feel generic. Each time it does, add a sentence to your <code>about-you.md</code> describing how this client typically retreats. After a few cycles it will start sounding like you wrote it.'
  },
  {
    id: 'p5', section: 'coach', audience: 'Coach',
    title: 'Post-session capture',
    description: 'Turn a session transcript or your own voice note into a structured client record and a follow-up email in your voice. The follow-up is the part most coaches skip and most clients secretly want.',
    prompt: `I've just finished a session with a client. Help me capture it properly.

<session-input>
[paste the transcript, your voice-note transcription, or your shorthand notes]
</session-input>

<client-context>
Name: [first name only]
Where they are in the programme: [e.g. session 4 of 12, or "third
discovery conversation"]
What I want them to leave with: [one sentence]
</client-context>

Apply style.md.

Produce TWO outputs:

OUTPUT 1: Structured client record (for my own file)
- Themes that came up (max 5, ordered by weight)
- Breakthroughs (specific moments, with the words the client used)
- Blockers (what's getting in the way, in their words)
- Actions they agreed to before next session (with the verb they used)
- One thing I should remember about how they're showing up

OUTPUT 2: Follow-up email (to send today)
- Subject line, under 8 words
- Opening that references something specific from the session, not generic
- One sentence acknowledging the work they did
- The actions they committed to, as a short bulleted list
- Closing that's mine, not "looking forward to next time"
- Under 150 words total

If any part of the session input is unclear or contradictory, flag it
in a third section called "Check before sending."`,
    tip: '<strong>Privacy note.</strong> If you\'re using a free-tier model, anonymise client names before pasting. On Pro tiers, this is usually opt-out covered by Anthropic\'s enterprise privacy commitments, but check your settings.'
  },
  {
    id: 'p6', section: 'coach', audience: 'Coach',
    title: 'Programme design from a discovery call',
    description: 'Discovery call transcript in. A draft 8 or 12-week coaching arc comes out, with session themes and the opening questions for each one. You\'ll edit half of it. That\'s the point. The half you don\'t edit is the half you got back.',
    prompt: `Draft a coaching programme arc based on a discovery call I just had.

<discovery-call>
[paste the transcript or your notes]
</discovery-call>

<programme-shape>
Duration: [6 / 8 / 12] weeks
Session length: [60 / 90] minutes
Cadence: [weekly / fortnightly]
</programme-shape>

Use about-you.md for how I coach. Apply style.md.

Output structure:

1. The client in one paragraph — what they came for, what's underneath
   what they came for, and the shift I think this programme is really
   about.

2. The arc, session by session. For each session:
   - Theme (3-5 words, not abstract)
   - The one shift I'm aiming for
   - The opening question I'd actually use
   - One thing the client should leave with

3. Risks I see — places this programme could go wrong, or places
   the client is likely to want to "fix" something I shouldn't be
   fixing for them.

4. Three questions I should ask the client BEFORE we start, to make
   sure I've designed this for them and not for someone I've already
   coached.

Constraints:
- The arc must build. No session should be replaceable.
- No generic session themes ("Vision", "Values", "Vulnerability"
  on their own). Be specific to what this client said.
- Total length under 800 words.`,
    tip: '<strong>How I use this.</strong> The output is never the final programme. It\'s a draft I can argue with. Half the value is in the third section — the risks — because that\'s the bit I\'d otherwise discover three sessions in.'
  },
  {
    id: 'p7', section: 'small-business', audience: 'Small business',
    title: 'Quote from enquiry',
    description: 'Customer enquiry comes in. A polished quote goes out, in your tone, with your pricing logic baked in. The first version is a draft. By the tenth use it\'s two-clicks-to-send.',
    prompt: `Help me turn a customer enquiry into a quote.

<enquiry>
[paste the email or message exactly as it arrived]
</enquiry>

<my-pricing-logic>
[3-5 lines describing how you price: base rates, what triggers a premium,
what you charge extra for, minimum spend, etc. Add to about-you.md once
you've written this twice.]
</my-pricing-logic>

Apply style.md.

Produce, in order:

1. What I think they're actually asking for, in plain English
2. Three clarifying questions to send back IF the brief is too vague
   to quote (skip this section if the brief is clear enough)
3. A scope, in bullets, of what's included
4. A scope, in bullets, of what's explicitly NOT included
5. The headline price (or price range if scope is uncertain)
6. A draft reply email — friendly, professional, mine — that:
   - Acknowledges what they're trying to do
   - Confirms the scope
   - Gives the price clearly
   - Suggests one specific next step (a call, a deposit, a start date)
   - Stays under 150 words

If the enquiry is missing something material (timeline, budget,
location, scope), don't guess. Flag it in section 2.`,
    tip: '<strong>Note.</strong> Don\'t paste customer details into a free-tier chat. Either anonymise or use a paid tier with privacy controls enabled. Bookkeepers and solicitors especially — check your professional obligations.'
  },
  {
    id: 'p8', section: 'small-business', audience: 'Small business',
    title: 'Invoice triage and chase',
    description: 'The inbox of receipts, invoices, and "remember to follow up on this" sticky notes goes in. A prioritised list comes out, plus drafted chasers for late payers. Add a Xero or FreeAgent connector and this gets dramatically more useful.',
    prompt: `I'm catching up on my accounts. Help me triage what needs action this week.

<invoices-out>
[list of invoices you've sent that haven't been paid yet. Format:
client name | invoice number | amount | date sent | due date]
</invoices-out>

<bills-in>
[list of bills you owe. Format: supplier | amount | due date]
</bills-in>

<todays-date>
[today's date]
</todays-date>

Apply style.md.

Produce, in this order:

1. Overdue invoices (sent but not paid past due date)
   - Sorted by days overdue, oldest first
   - For each: the action I should take TODAY (gentle nudge, firmer chase,
     phone call, stop work)

2. Upcoming invoices (due in next 7 days but not paid yet)
   - Sorted by due date
   - For each: a one-line preventative nudge I could send today

3. Bills due in next 7 days
   - Sorted by due date with running total
   - Flag anything that pushes me into a cashflow problem (you'll need
     to know my approximate weekly cash buffer — ask if I haven't said)

4. Draft chaser emails for everything in section 1
   - Each one in my voice, under 80 words
   - Tone graduated by days overdue:
     * 1-14 days: light, "in case it got lost"
     * 15-30 days: clearer, name the amount, name the date
     * 30+ days: firm, escalation language, no apology

5. One thing you noticed that I might want to act on (a client who's
   always late, a supplier I'm overpaying, a pattern in my receivables)`,
    tip: '<strong>Make it recurring.</strong> Once this runs reliably, schedule it for Monday morning. Half the value of this prompt is that it runs whether you remember it or not.'
  },
  {
    id: 'p9', section: 'small-business', audience: 'Small business',
    title: 'Daily ops brief',
    description: 'Today\'s calendar, today\'s unread emails, today\'s Stripe activity. Out comes a 30-second read that tells you what actually needs your attention today and what\'s noise. Best run as a scheduled task at 7am.',
    prompt: `It's morning. Give me a 30-second read of today.

<todays-calendar>
[paste today's calendar — events, with times and any notes]
</todays-calendar>

<unread-email-snippets>
[paste the first line of each unread email in your priority inbox.
Skip newsletters, social notifications, and anything obviously automated.]
</unread-email-snippets>

<stripe-or-sales-activity>
[any sales, refunds, failed payments, or churns from the last 24 hours]
</stripe-or-sales-activity>

Apply style.md.

Output, in this order. Total length must be under 250 words.

1. Today's shape — one sentence describing the day at a glance (busy / quiet
   / heavy on meetings / focus time available)
2. The one thing that MUST happen today (if there's nothing critical,
   say so)
3. Two meetings to over-prepare for, and why
4. Three emails that need a real reply today (with the action for each)
5. Anything in the sales activity that warrants a response (a refund,
   a failed payment, an unusually large order)
6. One thing I should actively NOT do today (a thing I'm tempted to do
   that isn't today's job)

If anything is missing or thin, just say so. Don't invent.`,
    tip: '<strong>Why item six matters.</strong> Most ops briefs tell you what to do. The one that earns its place tells you what to ignore. Most small business owners lose more hours to optional work than to busywork.'
  },
  {
    id: 'p10', section: 'founder', audience: 'Founder',
    title: 'Pitch deck self-critique',
    description: 'Paste your deck. Get the brutal, investor\'s-eye review you\'d usually pay an advisor for, before you spend a fortnight redrafting it. Best run with Opus or Sonnet with extended thinking on. Worst on Haiku.',
    prompt: `You are a Series A partner at a top-tier VC firm. You're reading my deck
for the first time. Be useful, not kind.

<deck>
[paste the deck content slide-by-slide, OR attach the PDF]
</deck>

<context>
Stage I'm raising at: [pre-seed / seed / Series A]
Cheque sizes I'm targeting: [e.g. £500k - £1.5m]
Funds I'm planning to send this to: [or "I don't know yet"]
</context>

Apply style.md.

Read the deck once for the story arc. Read it again for the evidence.
Then produce:

1. The one-line story — what this deck tells me you're building, who it's
   for, and why it might matter. If this doesn't land cleanly, that's the
   first problem.

2. The three slides doing the heaviest lifting, and the three slides I'd
   skip past as an investor.

3. Where I'd push back hardest (the claims that need stronger evidence,
   the numbers that don't add up, the market sizing that's pasted in from
   a McKinsey report).

4. The one question I'd ask in the first 60 seconds of the call, that
   this deck doesn't pre-empt.

5. What you'd cut. Not what you'd add. Specifically: which slides,
   sentences, or visuals are dead weight.

6. If I had to invest or pass right now, based only on this deck, which
   would I do, and what would change my mind?

Brutality calibration: I'm a real founder. I've raised before. I can take it.
But "brutal" doesn't mean cruel — be specific about what's actually wrong,
not just dismissive. If something works, say so once.

Length: under 1,000 words.`,
    tip: '<strong>How to use the output.</strong> Don\'t redraft the deck the same evening you run this. Sleep on it. About a third of what the model says will be wrong, about a third will be obvious, and about a third will be exactly what your advisor would have charged you £500 to say.'
  }
];

module.exports = { SECTIONS, PROMPTS };
