import Razorpay from 'razorpay';

// Fixed server-side. The amount is never read from the request body — a client
// that could name its own price could name zero.
export const AMOUNT_PAISE = 100; // Rs 1
export const CURRENCY = 'INR';

let cached;

export function getKeys() {
  return {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  };
}

export function getRazorpay() {
  if (cached) return cached;
  const { keyId, keySecret } = getKeys();
  if (!keyId || !keySecret) return null;
  cached = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return cached;
}

// Razorpay SDK errors carry { statusCode, error: { code, description } }.
// Surface a stable machine code so the UI can say something specific rather
// than "something went wrong".
export function describeGatewayError(err) {
  const status = err?.statusCode;
  const description = err?.error?.description || err?.message || 'Unknown gateway error.';

  if (status === 401) {
    return {
      status: 503,
      code: 'not_configured',
      error: 'Payment gateway credentials were rejected.',
      description,
    };
  }
  if (status === 400) {
    return { status: 400, code: 'gateway_rejected', error: description, description };
  }
  return {
    status: 502,
    code: 'gateway_error',
    error: 'The payment gateway is not responding.',
    description,
  };
}

export function methodGuard(req, res, allowed) {
  if (req.method === allowed) return false;
  res.setHeader('Allow', allowed);
  res.status(405).json({ code: 'method_not_allowed', error: 'Method not allowed.' });
  return true;
}
