export const COMPANY_EMAIL_DOMAIN = 'beva.com';

const COMPANY_USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;

/**
 * Keeps the registration control to the local part of the company email.
 * Pasting a full email is friendly: everything after "@" is discarded.
 */
export function normalizeCompanyUsername(value: string) {
  return value.trim().toLowerCase().replace(/@.*$/, '').replace(/\s+/g, '');
}

export function companyEmailFromUsername(value: string) {
  const username = normalizeCompanyUsername(value);
  return COMPANY_USERNAME_PATTERN.test(username) ? `${username}@${COMPANY_EMAIL_DOMAIN}` : null;
}
