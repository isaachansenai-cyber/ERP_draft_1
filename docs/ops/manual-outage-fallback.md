# Manual outage fallback

The app needs a working connection. There is no offline ordering, background sync or offline payment capture (PRD §15). When the connection or Supabase is down, the restaurant keeps working on paper, and the records are entered once the system is back. This page is the procedure. Print it and keep a copy at each location with a pad of numbered paper tickets.

## Recognising an outage

- The banner **"No connection — nothing was saved"** appears and posting buttons are disabled.
- An action shows **"Not confirmed — checking…"** and then **"Outcome unknown"**.
  - **Do not re-enter it.** When the connection returns, press **Check again**. The app looks up the request and shows whether it was saved.
  - An "Unsent draft" in the POS cart is **not** an order. It was never sent.
- If several screens fail for more than 5 minutes, the shift lead declares an outage and writes the start time on the outage sheet.

## During the outage

| Activity | Paper process |
|---|---|
| **Orders** | Write each order on a numbered paper ticket: ticket number, time, items and quantities, pickup name. Give the customer the ticket number as their pickup code (`PAPER-<location>-<number>`). The kitchen works from the ticket. |
| **Payments** | Take payment only through the external card terminal or cash, exactly as normal, since the app never moves money. Staple the terminal slip to the ticket, or write "cash" and the amount. |
| **Prices and tax** | Use the printed menu prices. Do not discount without a manager present; the manager initials the ticket with the reason. |
| **Stock** | Nothing is reserved or issued during the outage. Do not move stock between locations. Set aside any waste with a note (item, quantity, reason). |
| **Deliveries** | Accept deliveries against the supplier's packing slip, write the use-by date on perishable cases, and keep the slip. |
| **Clocking** | Staff write their name and start/end times on the outage timesheet. The manager initials each line. |
| **Returns and refunds** | Defer them until the system is back, unless the manager decides otherwise. Then the manager writes a note with the original receipt and the amount paid back externally. |

## When the system is back

Work in this order. Use the **Notes** fields to mark everything as "Outage entry — paper ticket N".

1. **Check uncertain actions first.** On each tablet, press **Check again** on any "Outcome unknown" message before entering anything, so nothing is duplicated.
2. **Deliveries:** receive each packing slip under **Purchasing** against its PO, with the use-by dates. The packing-slip number blocks entering the same slip twice.
3. **Orders:** enter each paper ticket in **POS** in ticket order (accept, then start, ready, record the payment with the terminal slip reference, and complete), with the ticket number in the order note. These sales post on the **recovery** business date. If the outage crossed midnight, the owner notes the affected dates, because the dashboard will show those sales on the entry date.
4. **Waste:** submit the set-aside waste as waste reports, and the manager posts them.
5. **Stock check:** the manager runs a **count** for the items most used during the outage (proteins, tortillas, rice) and posts differences with reason `COUNT_VARIANCE` and the note "post-outage".
6. **Time:** each employee clocks in and straight out once. Another manager then corrects the entry to the paper times under **Staff time → Time records & hours → Correct…**, with the reason "Outage paper timesheet". The original values stay on record.
7. **Refunds and returns** deferred during the outage are processed normally against the entered orders.
8. Write the outage end time on the outage sheet, file the tickets, slips and timesheets, and tell the owner.

## If the outage is a data loss

If Supabase is reachable but the data is damaged or missing, stop using the app and follow [`backup-restore.md`](backup-restore.md) (recovery). Everything after the last backup is entered again from paper records as above.
