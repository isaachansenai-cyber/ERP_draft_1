// Map stable server error codes (CLAUDE.md §5.4) to actionable messages.

const EXACT: Record<string, string> = {
  unauthorized: 'You do not have permission for this action at this location.',
  session_expired:
    'Your session expired before the server confirmed the action. Sign in again; we will check whether it was saved.',
  network_uncertain:
    'The server did not confirm the action (network problem or timeout). It may or may not have been saved.',
  network_offline: 'No connection — nothing was saved.',
  request_invalid: 'The request was not accepted. Refresh the page and try again.',
  'conflict:stale_version': 'Someone else changed this record. Refresh to see the latest version, then try again.',
  'conflict:request_key_reused': 'This action was already used for a different request. Start the action again.',
  'conflict:request_in_progress': 'The same request is still being processed. Wait a moment and check again.',
  'conflict:membership_exists': 'This person already has a role at that location. Revoke it first to change it.',
  'conflict:employee_already_linked': 'This staff record is already linked to a sign-in account.',
  'conflict:auth_user_already_linked': 'That sign-in account is already linked to another staff record.',
  'conflict:duplicate': 'A record with the same key already exists.',
  'conflict:retry': 'The database was busy. Try again.',
  'validation:evidence_note': 'Add an evidence note of at least 10 characters describing what you verified.',
  'validation:reason': 'A reason is required.',
  'validation:display_name': 'Enter a display name (1–120 characters).',
  'validation:auth_user_not_found':
    'No invited sign-in account uses that email. Invite the person through Supabase Auth first.',
  'validation:last_owner': 'At least one active owner must remain.',
  'validation:location_id': 'Owners are company-wide; managers and employees need a location.',
  'validation:pin_format': 'A manager PIN must be 6 to 12 digits.',
  'validation:pin_too_simple': 'That PIN is too easy to guess (repeated or sequential digits).',
  'validation:rate': 'Enter the tax rate as a decimal fraction, e.g. 0.0725 for 7.25%.',
  'validation:effective_from': 'The effective date must be today or later. Past rates and prices cannot be rewritten.',
  'validation:price_cents': 'Enter a price between $0.00 and $1,000.00.',
  'duplicate_business_key:tax_rate_effective_date': 'A tax rate already exists for that date.',
  'duplicate_business_key:price_effective_date': 'A price already exists for that item and date.',
  'setup_gate_closed:posting_prerequisites':
    'Posting stays off until roles, backup/restore and the acceptance suite are confirmed.',
  'forbidden:synthetic_data_in_pilot': 'Synthetic demo data cannot be written to the pilot database.',
  pin_invalid: 'The manager PIN was not accepted.',
  pin_locked: 'Too many wrong PINs. This manager PIN is locked for 15 minutes.',
  pin_not_set: 'That manager has not set a PIN yet.',
  approver_not_authorized: 'That person cannot approve actions at this location.',
  approval_required: 'A manager must approve this. Choose the approving manager and enter their PIN.',
  'validation:balance_due': 'Record the remaining payment before completing pickup.',
  'validation:amount_exceeds_balance':
    'The amount is more than the balance due. Record only what was collected for this order.',
  'validation:over_receipt_requires_acknowledgement':
    'This receipt is more than was ordered. Tick the over-receipt acknowledgement to post it (audited).',
  'validation:refund_method_required':
    'This order has a recorded payment. Choose how the refund is paid back; it is recorded with the cancellation.',
  'validation:refund_exceeds_line':
    'That is more than remains refundable on this line (original price, discount and tax).',
  'validation:refund_exceeds_recorded_payment': 'Refunds cannot exceed what was recorded as paid for this order.',
  'validation:refund_amount': 'Enter a refund amount greater than zero.',
  'validation:quantity_or_amount': 'Refund either a number of units or an amount, not both.',
  'validation:meals_are_refunded_not_returned': 'Meals are refunded, never returned to stock. Use Refund instead.',
  'validation:return_exceeds_sold': 'That is more units than were sold and not yet returned.',
  'validation:return_window_expired': 'This sale is outside the return window set in the return policy.',
  'validation:not_resaleable': 'Only unopened, intact, shelf-stable retail units can go back to stock.',
  'forbidden:customer_restock_disabled': 'The return policy does not allow returned goods back into stock.',
  'validation:exchange_retail_only': 'Exchanges are for retail items only.',
  'validation:excess_refund_method_required':
    'The returned value exceeds the replacement. Choose how the difference is paid back.',
  'validation:count_below_reserved': 'A count cannot be lower than what is reserved for accepted orders on that lot.',
  'conflict:stock_changed_since_count':
    'Stock moved after this count was started. Cancel it and start a new count for the affected items.',
  'validation:exceeds_in_transit': 'That is more than is still in transit on this line.',
  'validation:lot_expired': 'An expired lot cannot be released back to sellable stock.',
  'validation:to_location': 'Choose a different destination location.',
  'duplicate_business_key:invoice_number':
    'This supplier invoice number was already entered (numbers are compared ignoring case and spaces).',
  'validation:due_date_required': 'Enter the due date from the invoice: this supplier’s terms are not verified yet.',
  'validation:overpayment': 'That payment is more than the invoice balance.',
  'validation:credit_exceeds_balance': 'That credit is more than the invoice balance.',
  'validation:total_below_applied':
    'The corrected total is below what was already paid or credited. Reverse a payment first.',
  'validation:receipt_line_mismatch': 'That receipt line belongs to another supplier or location.',
  'invalid_state:discrepancy_not_accepted':
    'This invoice differs from what was received. A manager must accept the discrepancy before payment.',
  'invalid_state:payments_or_credits_applied': 'Reverse the payments and credits on this invoice before voiding it.',
  'invalid_state:already_reversed': 'That record was already reversed.',
  'invalid_state:opening_already_posted':
    'Opening stock for this location was already posted. Use counts and adjustments instead.',
  'validation:item_unavailable': 'That item is switched off on this location’s menu.',
  'validation:no_price': 'That item has no price at this location. Ask a manager to set one.',
  'validation:no_tax_rate': 'This location has no tax rate. The owner must enter one.',
  'validation:use_by_required': 'This item needs a use-by date.',
  'validation:unverified_conversion': 'That unit cannot be converted for this item without a verified conversion.',
  'duplicate_business_key:packing_slip_ref': 'That packing slip was already received from this supplier.',
  'validation:employee_daily_summary_only': 'Employees can view one day at a time.',
  'validation:discount_reason': 'A discount needs a reason.',
  'validation:zero_value_requires_approval': 'A zero-total order needs a manager-approved 100% discount.',
  'validation:pack_not_defined': 'That supplier item has no pack size yet. The owner sets it under Suppliers & packs.',
  'validation:reason_code': 'Choose a reason.',
  'validation:note_required': 'Add a note for reason OTHER.',
};

interface Shortage {
  name?: string;
  item_id?: string;
  shortfall?: string;
  base_unit?: string;
}

function trimDecimal(value: string | undefined): string {
  if (!value) return '?';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

export function describeError(code: string, detail?: Record<string, unknown> | null): string {
  if (code === 'insufficient_stock') {
    const shortages = Array.isArray(detail?.shortages) ? (detail.shortages as Shortage[]) : [];
    if (shortages.length) {
      return `Not enough stock: ${shortages
        .map((s) => `${s.name ?? s.item_id} short by ${trimDecimal(s.shortfall)} ${s.base_unit ?? ''}`.trim())
        .join('; ')}. Nothing was reserved.`;
    }
    return 'Not enough eligible stock. Nothing was changed.';
  }
  if (EXACT[code]) return EXACT[code];
  if (code.startsWith('setup_gate_closed:')) {
    return `Blocked by an unconfirmed setup gate: ${code.slice('setup_gate_closed:'.length).replaceAll('_', ' ')}.`;
  }
  if (code.startsWith('setup_gate_precondition:')) {
    const reason =
      typeof detail?.reason === 'string' ? detail.reason.replaceAll('_', ' ') : 'a required value is missing';
    return `This gate cannot be confirmed yet: ${reason}.`;
  }
  if (code.startsWith('invalid_state:'))
    return 'This record is no longer in a state that allows that action. Refresh and check.';
  if (code.startsWith('validation:'))
    return `Check the input: ${code.slice('validation:'.length).replaceAll('_', ' ')}.`;
  if (code.startsWith('immutable:')) return 'Posted records cannot be changed. Use a linked correction instead.';
  return `The server rejected the action (${code}).`;
}
