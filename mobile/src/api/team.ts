export type TeamMember = {
  id: number;
  name: string;
  /** Masked except the last 4 digits — the server never sends the full number back. */
  mobile: string;
  role: string;
};
