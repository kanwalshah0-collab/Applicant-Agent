'use strict';

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
  return transporter;
}

/**
 * Sends the candidate their dashboard access details after profile creation.
 * Best-effort — logs and returns without throwing if email isn't configured or fails,
 * so a flaky mail server never blocks profile creation.
 * @param {{ to: string, name: string, candidateId: string, dashboardUrl: string, shareableUrl: string }} params
 */
async function sendWelcomeEmail({ to, name, candidateId, dashboardUrl, shareableUrl }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('[email] GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping welcome email');
    return;
  }

  const subject = 'Your Applicant Agent profile is live';
  const text = `Hi ${name},

Your AI representative profile has been created.

Candidate ID: ${candidateId}
Dashboard: ${dashboardUrl}

Sign in with your Candidate ID above and the dashboard password you were given.

Share this link with recruiters — your AI representative answers on your behalf:
${shareableUrl}

— Applicant Agent`;

  try {
    await getTransporter().sendMail({
      from: `"Applicant Agent" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text,
    });
    console.log(`[email] welcome email sent to ${to}`);
  } catch (err) {
    console.error('[email] failed to send welcome email:', err.message);
  }
}

module.exports = { sendWelcomeEmail };
