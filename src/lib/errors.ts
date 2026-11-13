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
};

export function describeError(code: string, detail?: Record<string, unknown> | null): string {
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
