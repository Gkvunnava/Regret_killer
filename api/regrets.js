import { readLedger } from './_lib/ledger.js';
import { methodGuard } from './_lib/payment.js';

// Read only. Writes happen in verify-payment, behind a confirmed Rs 1 payment —
// an open POST here let anyone run the counter up for free.
export default async function handler(req, res) {
  if (methodGuard(req, res, 'GET')) return;

  try {
    const ledger = await readLedger();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(ledger);
  } catch (err) {
    console.error('ledger error:', err.message);
    return res.status(503).json({ code: 'ledger_unavailable', error: 'Ledger unavailable.' });
  }
}
