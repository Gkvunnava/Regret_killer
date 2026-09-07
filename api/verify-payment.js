import crypto from 'crypto';
import {
  AMOUNT_PAISE,
  CURRENCY,
  describeGatewayError,
  getKeys,
  getRazorpay,
  methodGuard,
} from './_lib/payment.js';
import { claimPayment, recordRegret } from './_lib/ledger.js';

const ID_RE = /^[A-Za-z0-9_]{6,64}$/;
const SIGNATURE_RE = /^[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{12}$/;

// Razorpay auto-capture may land the payment on either of these.
const PAID_STATUSES = new Set(['captured', 'authorized']);

function fail(res, status, code, error, extra = {}) {
  return res.status(status).json({ verified: false, code, error, ...extra });
}

export default async function handler(req, res) {
  if (methodGuard(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');

  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
    hash,
  } = req.body || {};

  if (!ID_RE.test(String(orderId)) || !ID_RE.test(String(paymentId))) {
    return fail(res, 400, 'bad_request', 'Missing or malformed payment fields.');
  }
  if (!SIGNATURE_RE.test(String(signature))) {
    return fail(res, 400, 'bad_request', 'Missing or malformed signature.');
  }
  if (!HASH_RE.test(String(hash))) {
    return fail(res, 400, 'bad_request', 'Send a 12-character hex hash.');
  }

  const { keySecret } = getKeys();
  if (!keySecret) {
    console.error('verify-payment: RAZORPAY_KEY_SECRET is not set');
    return fail(res, 503, 'not_configured', 'Payment gateway is not configured yet.');
  }

  // 1. The signature proves the ids came from Razorpay and not from a caller
  //    who simply invented them.
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return fail(res, 400, 'signature_mismatch', 'That payment could not be verified.');
  }

  // 2. The signature alone says nothing about whether money actually moved, so
  //    ask Razorpay what the payment really is.
  const razorpay = getRazorpay();
  let payment;
  try {
    payment = await razorpay.payments.fetch(paymentId);
  } catch (err) {
    const mapped = describeGatewayError(err);
    console.error('verify-payment fetch error:', mapped.description);
    return fail(res, mapped.status, mapped.code, mapped.error);
  }

  if (payment.order_id !== orderId) {
    return fail(res, 400, 'order_mismatch', 'That payment belongs to a different order.');
  }
  if (!PAID_STATUSES.has(payment.status)) {
    return fail(res, 402, 'payment_not_captured', 'That payment has not gone through.', {
      status: payment.status,
    });
  }
  if (Number(payment.amount) !== AMOUNT_PAISE || payment.currency !== CURRENCY) {
    return fail(res, 400, 'amount_mismatch', 'That payment is for the wrong amount.');
  }

  // 3. One payment burns one regret. Everything past here is best effort: the
  //    money is already taken, so a ledger outage must not read as a failure.
  let ledger = null;
  let ledgerState = 'ok';

  try {
    if (!(await claimPayment(paymentId))) {
      return fail(res, 409, 'already_used', 'That payment has already been used.');
    }
    ledger = await recordRegret(hash);
  } catch (err) {
    console.error('verify-payment ledger error:', err.message);
    ledgerState = 'unavailable';
  }

  return res.status(200).json({
    verified: true,
    payment_id: paymentId,
    order_id: orderId,
    ledger: ledgerState,
    count: ledger ? ledger.count : null,
    wall: ledger ? ledger.wall : null,
  });
}
