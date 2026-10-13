export type TeamMember = {
  id: number;
  user_id: number;
  name: string;
  /** Masked except the last 4 digits — the server never sends the full number back. */
  mobile: string;
  role: string;
  /** Null if this person has never logged in. */
  last_login_at: string | null;
  added_at: string;
};
