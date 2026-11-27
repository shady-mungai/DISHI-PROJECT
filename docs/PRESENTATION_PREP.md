# Mlo: An Intelligent School Feeding Management and Communication System

Presentation rehearsal pack.

Prepared 17 November 2026 for the presentation on 18 November 2026. Based on the current source, not a live deployment inspection. Default timing: 12 minutes plus questions; adjust to the panel's allocation.

## The story to remember

**Follow one meal from planning to accountability.**

Problem → forecast → dispatch → school receipt → meal collection → guardian communication → reconciliation → human review.

Your central claim: “Mlo turns school feeding records into timely decisions for schools, guardians, suppliers and programme administrators.”

Use **Mlo: An Intelligent School Feeding Management and Communication System** as the formal title. The interface’s **mlo.** wordmark is the visual brand for the same project.

## Opening: learn these words, then speak naturally

“A school feeding programme has to answer three practical questions: how many meals should we prepare, was the delivery received, and did each pupil collect a meal? Those answers matter to different people. The supplier needs a demand estimate, the school needs a reliable service record, the guardian needs timely information, and the county needs accountability.

“Mlo connects those decisions through a shared event record. I will follow one meal through the system, then show how historical forecasting and configurable rules turn those records into useful action.”

Pause. Then begin the demo. Do not open with your technology stack.

## Twelve-minute presentation flow

| Time | Show or explain | Point to make |
|---|---|---|
| 0:00–1:00 | Problem and users | Information arrives too late or remains disconnected. |
| 1:00–1:40 | Objective and workflow diagram | One traceable journey links planning, service and oversight. |
| 1:40–2:40 | Supplier forecast | Historical collection patterns inform preparation. |
| 2:40–4:20 | Supplier dispatch and school receipt | Declared quantities and independently recorded received quantities are distinct. |
| 4:20–5:20 | Supplier redeems the school's code | Two-party handshake: only a matching code confirms receipt for payment. |
| 5:20–6:40 | Pupil meal collection and school counts | A tap records collection and updates the shared record. |
| 6:40–7:30 | Guardian notification and trace | Rules choose communication; policy controls whether and when it sends. |
| 7:30–8:40 | Reconciliation and county view | Compare confirmed receipts with collection records and investigate exceptions. |
| 8:40–10:00 | Intelligence summary and forecast error | Explain each method and how it can be evaluated. |
| 10:00–11:10 | Architecture, access control and tests | Briefly justify design choices with evidence. |
| 11:10–12:00 | Limitations and closing | State the implemented contribution and its practical limits. |

For eight minutes, use a pre-existing dispatch and code redemption; omit enrolment, USSD, payment-file export and the detailed architecture explanation. Preserve forecasting, meal collection, one exception and the intelligence explanation.

For twenty minutes, add a quantity discrepancy, an admin rule dry run, and forecast error/bias. Add detail to the same story rather than touring every menu.

## A focused slide outline

1. **Mlo: An Intelligent School Feeding Management and Communication System.** Your name, admission number and assessed title.
2. **The operational problem.** Four users and the question each needs answered.
3. **One meal, one traceable journey.** Forecast → dispatch → receipt → collection → communication → reconciliation.
4. **Live demonstration.** State the school and scenario before switching to the application.
5. **Where intelligence enters.** Predictive forecasting, rules and exception detection. Use the input → method → output → decision structure below.
6. **Why this architecture.** Next.js/React interface; Convex data, functions and scheduling; external messaging services.
7. **Evaluation and limitations.** Automated correctness evidence versus field accuracy and live integration evidence.
8. **Contribution.** Connect operational records to timely, explainable decisions.

Use one sentence as each slide's message. Put screenshots and a few labels on slides; keep the explanation in your speech. Do not paste source code onto every slide.

## Demo script: what to click and what to say

Use a dedicated demonstration school and test guardians. Simulation and service actions write real application records and may trigger messages. Keep all tabs on the intended dates. New reader/staff meal records are for today, even when a dashboard displays a past date. Tomorrow's forecast panels use the current date; historical date filters do not move every panel together.

Keep separate signed-in browser profiles for the school and supplier if available. An admin can open supplier screens, but the new school receipt action requires a school-role account for that school; an admin session is not a substitute. Rehearse switching before the presentation.

### 1. Begin at the supplier overview: `/supplier`

Point at tomorrow's portions, confidence and update time.

Say: “The supplier needs a preparation decision before food is cooked. This recommendation uses the school's historical meal collection rate, prioritising matching weekdays.”

Use the actual visible number. An illustrative calculation is below; do not describe it as measured production data.

### 2. Declare a dispatch: `/supplier/dispatch`

Choose the demonstration school; enter portions, vehicle and a unique docket reference. Submit once. Point out the delivery reference and expected arrival.

Say: “This records what the supplier says was sent. The school separately records what it received.”

For a short slot, start with a prepared dispatch and show its record instead of typing.

### 3. Record school receipt: `/school/deliveries`

Find the matching docket. Open “Record receipt and view details”. Record received portions and press “Record quantities and get receipt code”. A six-digit code appears, valid for 30 minutes.

Say: “The school records what actually arrived. The quantity stays pending until the supplier proves they were there.”

### 4. Supplier redeems the code: `/supplier`

In the supplier session, open the delivery and enter the school's code. A matching quantity without a reported problem confirms receipt; a mismatch or reported problem creates a dispute for admin resolution.

Say: “Confirmation needs both parties: the school issues the code, the supplier enters it. Five wrong attempts lock the code for 15 minutes. Only confirmed receipts reach the payment file.”

Edge case to show if time allows: enter a wrong code and point at the rejection in the delivery timeline. If a code expires, the school issues a replacement; there is no photo fallback.

### 5. Record a meal: `/school/service` and `/reader`

Use one known assigned tag on a registered reader. Point to accepted collection and the updated school counts. If using a manual staff override, call it an override and explain that the reason is recorded. If using the service simulator in `/school/tools`, call it simulated input.

Say: “This event links the pupil, school and service date. The dashboard reacts to the recorded collection, and the notification pipeline evaluates the event.”

A tap is evidence of recorded meal collection; it cannot establish that the child ate the food or obtained nutritional benefit.

### 6. Show guardian communication

Use school communications at `/school/communications`, or admin message tracing at `/admin/trace`, to show the event's resulting notification and its status.

Say: “The rule identifies the relevant message. The policy checks consent preferences, quiet hours, message caps and merging. A recorded notification is distinct from a confirmed handset delivery.”

Only show a real handset SMS as delivered if it actually arrived. Console mode is demonstration output; external delivery depends on provider configuration. Quiet hours, merging and caps may prevent an immediate send.

### 7. Close the operational loop

Open `/supplier/reconciliation`, then `/county` or `/county/schools`. If a refresh is needed, the school operations tools expose “Run reconciliation now”. Select the intended service date before running it.

Say: “Reconciliation compares school-confirmed portions with recorded meal collections. A discrepancy is a reason to investigate, not proof of fraud.”

The county view also identifies repeated variance and high override rates. Use a prepared example for these patterns; one newly created discrepancy is not a multi-day streak.

For missed meals, explain that pending expectations become missed only after their cutoff. Running the sweep early does not bypass time. Show a previously completed day rather than waiting during the presentation.

## How to explain the intelligence precisely

### A. Historical demand forecasting

**Input:** active roster size and historical expected/fulfilled meal counts.

**Method:** use the aggregate fulfilment rate from matching weekdays first; use available history if matching weekday data is absent; use the full active roster if there is no usable history.

**Formula:** forecast portions = ceiling(active pupils × historical fulfilled / historical expected), using the selected history.

**Illustration:** three prior Wednesdays each expected 100 pupils and recorded 80, 85 and 90 fulfilled meals. Rate = 255/300 = 85%. For 120 active pupils, forecast = ceiling(120 × 0.85) = **102 portions**.

**Confidence:** high means at least three usable matching-weekday samples; fewer matching samples or general history give medium; roster fallback gives low. These are heuristic evidence labels, not calibrated probabilities or statistical confidence intervals.

Say: “This is an explainable historical forecasting heuristic. It recomputes from recorded outcomes; I did not train a machine-learning demand model.”

**Evaluation:** `/supplier/accuracy` displays mean absolute percentage error and signed bias, both relative to the forecast. Positive bias means over-forecasting. Zero forecasts are excluded from this calculation. Do not call the displayed ± error an accuracy percentage or claim standard actual-denominator MAPE.

### B. Rule-based decisions and exception detection

**Input:** event type, event fields, expectations, timing and settings.

**Method:** JSON predicates support comparisons and AND/OR/NOT composition; matched rules feed a notification policy. Other deterministic checks identify missed collection, slow service, recurring reconciliation variance and unusual override rates.

**Output:** a notification, a deferred/merged/suppressed message, or an exception for attention.

**Illustration:** halfway through a service window, a linear model expects 50 of 100 meals collected. If 20 are recorded, shortfall = (50−20)/50 = **60%**. Alerting depends on the configured threshold. The service monitor is scheduled at the window midpoint; do not describe it as continuous learned anomaly detection.

Say: “These are explicit inference and policy rules, so I can explain why an action occurred. The admin can edit notification rules and replay them against historical events before enabling them.”

Limits: slow service may reflect a reader or connectivity issue; a missing tap is not proof a child went hungry. The system identifies records requiring follow-up.

### C. Optional supporting example: wallet depletion forecasting

Balance divided by meal price gives whole meals remaining. Observed meals per school day and the upcoming school calendar estimate when the balance will no longer cover demand. New pupils use an assumed rate; a zero observed rate or insufficient calendar horizon can produce no projected date. Low-balance warnings also use a re-arm margin to avoid repeated warnings near the threshold.

Keep this for questions unless it is a central assessed objective.

## Likely panel questions and answers

**“Where is the intelligence?”**

“In two places: forecasting demand from historical collection patterns, and applying explainable rules to operational events. Each converts an input into a recommendation or action.”

**“Is this machine learning?”**

“No trained model is used. The demand forecast is a statistical heuristic, and the notification and exception logic is rule-based. I chose explainable methods because the data is sparse and every decision has to be justified to a supplier or county officer.”

**“Why not train your own forecasting model?”**

“The current implementation uses an interpretable baseline appropriate for limited historical data. I would compare any trained replacement against this baseline on held-out school days before claiming an improvement.”

**“How accurate is it?”**

“The supplier view calculates forecast error and bias for recorded days. The result must be interpreted with its sample size and data source.” Use an actual measured figure only if you have one.

**“Why did you drop photo evidence?”**

“A photo can't prove quantity, and it only came from the school. A code the supplier must enter is two-party proof, works with no data connection, and is cheaper. So photos were removed entirely.”

**“Does a discrepancy prove theft?”**

“No. It may reflect attendance, recording errors, portions left over or other operational causes. It is an investigation signal.”

**“Does the NFC tag prove the right child ate?”**

“It records a collection associated with an assigned tag. It is not biometric identity verification and does not prove consumption.”

**“What if the internet fails?”**

“The reader has a local pending-tap queue for later synchronisation. That covers reader capture, not offline operation of every feature. Receipt codes are read aloud between school and driver, so confirmation does not depend on uploading anything.”

**“Why Next.js and Convex?”**

“Next.js and React provide the role-based web interface. Convex provides transactional data changes, reactive queries and scheduled work, which fit the event-driven workflow. A tradeoff is dependence on Convex; much of the business logic is plain TypeScript.”

**“What prevents one school seeing another school's data?”**

“Backend functions derive identity and enforce role and school scope. Authorization does not rely only on hidden navigation links. Delivery photo access is authenticated.”

**“What have you tested?”**

“The local automated run on 17 November passed 162 tests in 26 files, including forecasting, policy, wallets, expectations, reconciliation and the photo workflow. The external photo responses are mocked in those tests, so that result does not establish live model accuracy or handset delivery.”

**“What is the main limitation?”**

“Decision quality depends on complete collection records and representative history. The demand forecast does not yet model every cause of attendance changes, and visual findings require human judgment.”

**“How does this compare with the original proposal?”**

If your submitted proposal names Python, RabbitMQ, MySQL or a trained forecasting model, acknowledge the implementation change directly: “The implementation uses Next.js and Convex, with a historical forecasting baseline and externally provided visual inference. I can explain the change and map the implemented behavior to each objective.” Do not claim an architectural component exists merely because it appears in an older diagram. The renamed report is available at `docs/Mlo_Project_Report.docx`; earlier report copies retain their historical wording.

## How to sound confident

- Memorise the opening, the three-part intelligence explanation and the closing. Use cues for the middle.
- Before clicking: state the user's question. After clicking: point to the evidence and explain the consequence.
- Speak in short sentences. Pause after the key result. Face the panel while explaining; face the screen when pointing.
- For answers, use **claim → mechanism → evidence → limit**. Answer the question first, then expand if asked.
- If you do not know a measurement: “I have not measured that yet. I would evaluate it by …” Give the specific method.
- Give a failed demo step one retry and about 20 seconds. Then show prepared evidence and continue. Do not spend the slot debugging.
- Call data “demonstration data” when it is seeded or simulated. Say “intended to reduce waste” unless you have measured a reduction.

Recovery line: “The live service is not responding. This prepared record shows the same workflow; I will distinguish the recorded result from what is running live.”

## Closing: about 25 seconds

“Mlo connects a meal's operational journey to the people who need to act. The supplier gets a demand recommendation, the school records receipt and collection, guardians receive relevant communication, and programme managers can investigate discrepancies. Its intelligence combines historical forecasting and explainable rules, with a traceable record and human responsibility for consequential decisions.”

## Tonight and tomorrow

The manual preparation checklist and exact terminal commands are recorded in the gitignored `developer-notes.md` under **2026-11-17 — Presentation rehearsal**. Prioritise a timed full run and saved fallback evidence. Do not attempt an untested feature expansion tonight.

Suggested rehearsal: first run with this script; second run using only the eight slide titles; third run practise the opening, intelligence answer, one failure recovery and closing. Spend the final few minutes answering the panel questions aloud.

## Source anchors

- Forecast method: `convex/lib/supply.ts`; history collection: `convex/deliveries.ts`.
- Forecast evaluation and linear run rate: `convex/lib/monitor.ts`.
- Predicates and notification decisions: `convex/lib/predicate.ts`, `convex/lib/policy.ts`, `convex/rules.ts`.
- Delivery confirmation (code handshake): `convex/deliveryWorkflow.ts`, `convex/lib/deliveryWorkflow.ts`.
- Wallet projection: `convex/wallets.ts`, `convex/lib/wallet/threshold.ts`.
- Demonstrated workflow behavior: `convex/deliveryWorkflow.test.ts`.

Verification boundary: source review and local automated tests completed. No live account walkthrough, external model availability check, handset SMS verification, actual NFC test or institutional submission-requirements review was performed for this preparation.
