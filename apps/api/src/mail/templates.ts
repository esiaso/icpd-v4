/** Email templates (MJML). Each returns subject + MJML body; rendering happens in the worker. */
export type MailTemplate =
  | 'VerifyEmail'
  | 'PasswordReset'
  | 'NewDeviceLogin'
  | 'NotifySubmission'
  | 'NotifyReSubmission'
  | 'NotifyReturn'
  | 'NotifyApproval'
  | 'NotifyImport'
  | 'NotifyApplicationDelete'
  | 'NotifyClaimRejection'
  | 'NotifyProviderUser';

export interface MailJob {
  to: string;
  template: MailTemplate;
  data: Record<string, any>;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string, cta?: { label: string; url: string }) {
  return `<mjml><mj-body background-color="#f4f6f8">
  <mj-section background-color="#0f5132"><mj-column><mj-text color="#fff" font-size="20px" font-weight="bold">ICPD</mj-text></mj-column></mj-section>
  <mj-section background-color="#ffffff"><mj-column>
    <mj-text font-size="18px" font-weight="bold">${esc(title)}</mj-text>
    <mj-text font-size="14px" line-height="22px">${body}</mj-text>
    ${cta ? `<mj-button background-color="#0f5132" href="${esc(cta.url)}">${esc(cta.label)}</mj-button>` : ''}
  </mj-column></mj-section>
  <mj-section><mj-column><mj-text font-size="11px" color="#888">You are receiving this email because of your account on the ICPD platform.</mj-text></mj-column></mj-section>
</mj-body></mjml>`;
}

export function renderTemplate(t: MailTemplate, d: Record<string, any>): { subject: string; mjml: string } {
  switch (t) {
    case 'VerifyEmail':
      return { subject: 'Verify your email address', mjml: layout('Verify your email', `Hello ${esc(d.name)}, please confirm your email address. The link expires in 60 minutes.`, { label: 'Verify email', url: d.url }) };
    case 'PasswordReset':
      return { subject: 'Reset your password', mjml: layout('Password reset', `Hello ${esc(d.name)}, use the button below to set a new password. The link expires in 60 minutes. If you did not ask for this, ignore this email.`, { label: 'Reset password', url: d.url }) };
    case 'NewDeviceLogin':
      return { subject: 'New sign-in to your account', mjml: layout('New sign-in', `Hello ${esc(d.name)}, your account was signed in from a new device.<br/>IP: ${esc(d.ip)}<br/>Browser: ${esc(d.userAgent)}<br/>Time: ${esc(d.time)}<br/>If this wasn't you, change your password now.`) };
    case 'NotifySubmission':
      return { subject: 'Application submitted', mjml: layout('Application received', `Hello ${esc(d.name)}, your registration application <b>${esc(d.applicationNo)}</b> has been submitted. We will notify you once it has been reviewed.`) };
    case 'NotifyReSubmission':
      return { subject: 'Application resubmitted', mjml: layout('Application resubmitted', `Hello ${esc(d.name)}, your application <b>${esc(d.applicationNo)}</b> has been resubmitted for review.`) };
    case 'NotifyReturn':
      return {
        subject: 'Your application needs changes',
        mjml: layout('Application returned', `Hello ${esc(d.name)}, your application <b>${esc(d.applicationNo)}</b> was returned. Please update the following sections:<br/><ul>${(d.sections ?? []).map((s: any) => `<li><b>${esc(s.section)}</b>${s.notes ? `: ${esc(s.notes)}` : ''}</li>`).join('')}</ul>`, { label: 'Edit application', url: d.url }),
      };
    case 'NotifyApproval':
      return { subject: 'Application approved', mjml: layout('Welcome to ICPD', `Hello ${esc(d.name)}, your application <b>${esc(d.applicationNo)}</b> has been approved. You can now claim CPD points.`, { label: 'Open portfolio', url: d.url }) };
    case 'NotifyImport':
      return { subject: 'Profile imported', mjml: layout('Profile linked', `Hello ${esc(d.name)}, your existing practitioner profile (${esc(d.regNo)}) has been linked to your account.`, { label: 'Open portfolio', url: d.url }) };
    case 'NotifyApplicationDelete':
      return { subject: 'Application deleted', mjml: layout('Application deleted', `Hello ${esc(d.name)}, your incomplete application ${esc(d.applicationNo)} has been deleted.`) };
    case 'NotifyClaimRejection':
      return { subject: 'CPD claim rejected', mjml: layout('Claim rejected', `Hello ${esc(d.name)}, your claim for <b>${esc(d.activityName)}</b> submitted on ${esc(d.claimDate)} was rejected.<br/><b>Reason:</b> ${esc(d.reason)}`) };
    case 'NotifyProviderUser':
      return { subject: `You have been added to ${d.providerName}`, mjml: layout('Provider access', `Hello ${esc(d.name)}, you have been added as a coordinator for <b>${esc(d.providerName)}</b>.${d.setPasswordUrl ? ' Set your password to get started.' : ''}`, d.setPasswordUrl ? { label: 'Set password', url: d.setPasswordUrl } : { label: 'Open workspace', url: d.url }) };
  }
}
