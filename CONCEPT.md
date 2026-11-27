# Mlo: An Intelligent School Feeding Management and Communication System

Application concept and features.

Mlo manages the information around a school feeding programme: **how much food to prepare, what reaches each school, which pupils collect meals, what guardians are told, and what deliveries qualify for supplier payment.**

The main flow is:

**Forecast demand → dispatch food → record receipt → serve meals → reconcile records → export payment file.**

## 1. Forecast: “How many portions should we prepare tomorrow?”

The forecast estimates demand for each school using its active pupil roster and the previous 14 days of meal collection.

It prioritises patterns from the same weekday. If that history is unavailable, it uses other recent days. With no history, it estimates one portion per active pupil and marks confidence as low.

For example, if a school has **500 active pupils** and its relevant historical meal collection rate is **80%**, the forecast suggests **400 portions**.

This helps suppliers plan cooking and reduce shortages or excess food. It is an estimate based on recorded history.

## 2. Reconciliation: “Do the quantities in our records agree?”

Reconciliation brings together the figures for each school and day:

| Figure | Meaning |
|---|---|
| Forecast | How many portions the system predicted would be needed |
| Dispatched | How many portions the supplier declared it sent |
| Received | How many portions the school recorded receiving, including disputed receipts |
| Confirmed | Received portions on deliveries that have been confirmed |
| Eaten | Meals recorded as served through pupil taps or staff overrides |
| Variance | Confirmed portions minus recorded meals served |

For example:

- Supplier dispatched **450 portions**.
- School received and confirmed **440 portions**.
- **400 meals** were recorded as served.
- Reconciliation shows a **40-portion variance**, about **9% of confirmed portions**.

That gives staff two things to investigate: the **10-portion difference between dispatch and receipt**, and the **40 confirmed portions without matching meal-service records**.

A variance does **not automatically prove waste or theft**. It might reflect leftovers, missing taps, delayed records, or incorrect quantities. Also, “eaten” is the application’s label for a recorded meal collection; it does not verify that a child finished the food.

## 3. Forecast accuracy: “How good were our predictions?”

This compares past forecasts with recorded meals served.

- **Average error** shows how far forecasts typically missed demand; lower is better.
- **Bias** shows whether forecasts tend to run too high or too low.

This helps suppliers judge whether the forecast is reliable enough for planning.

## 4. Dispatch and delivery receipt

Suppliers record the destination school, portion count, vehicle and delivery docket reference. Schools record what arrived and report problems.

Quantity differences or reported problems go to central admin for resolution. Delivery history and timelines help users follow each delivery, while alerts highlight overdue arrivals or missing confirmations.

The school confirms receipt with a one-time code that the supplier enters. If the supplier cannot enter the code, the school can confirm with a photo instead, and central admin reviews it.

## 5. Meal service and NFC reader

Pupils tap an NFC tag when collecting a meal. The application records service and updates the school’s **pending, served and missed** counts.

Staff can record a meal manually when a tag is forgotten, lost or damaged, or a reader is down. Each override captures a reason and the responsible staff member. Duplicate checks prevent another meal record for the same pupil that day.

The reader can queue taps during connection problems and sync them later.

## 6. Pupils and enrolment

Schools can import an enrolment PDF, review pupil details, link guardians, assign NFC tags and record opening wallet balances. The roster connects each pupil to their meal records and guardian contacts.

## 7. Wallets and guardian communication

Wallet records track balances, top-ups and meal deductions. Balance alerts help guardians know when funds are running low.

Guardian messaging supports meal-served notices, missed-meal alerts, low-balance messages and weekly summaries. USSD supports checking today’s status, balance, recent meals and notification preferences in English or Swahili.

Actual SMS and USSD availability depends on the configured provider.

## 8. County oversight and payment files

The county dashboard compares schools, highlights discrepancies and repeated exceptions, and shows programme totals such as meals served and guardians reached.

Payment files export **confirmed received portions × the configured supplier rate**. Unconfirmed or disputed deliveries are excluded until confirmed. Exporting the file prepares payment information; it does not itself transfer money.

## 9. Administration and operations

Admins can manage notification rules, inspect message delivery and SMS spending, trace messages, revoke devices, review delivery disputes, inspect audit history, and adjust settings and retention periods.

School operations tools can manually run daily processing or simulate meal service. Those tools act on real application records.

Each workspace serves a different responsibility: **schools record receipt and meal service; suppliers plan and deliver; county staff oversee performance and payment records; admins manage exceptions and system operations.**
