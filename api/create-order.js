import {
  AMOUNT_PAISE,
  CURRENCY,
  describeGatewayError,
  getKeys,
  getRazorpay,
  methodGuard,
} from './_lib/payment.js';

export default async function handler(req, res) {
  if (methodGuard(req, res, 'POST')) return;

  const razorpay = getRazorpay();
  if (!razorpay) {
    console.error('create-order: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set');
    return res.status(503).json({
      code: 'not_configured',
      error: 'Payment gateway is not configured yet.',
    });
  }

  try {
    const order = await razorpay.orders.create({
      amount: AMOUNT_PAISE,
      currency: CURRENCY,
      // Receipt is capped at 40 chars by Razorpay.
      receipt: `regret_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      notes: { product: 'one-rupee-one-regret' },
    });

    // No-store: an order id is single use, a cached one would be replayed by
    // the next visitor behind the same CDN edge.
    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: getKeys().keyId, // publishable by design
    });
  } catch (err) {
    const mapped = describeGatewayError(err);
    console.error('create-order error:', mapped.description);
    return res.status(mapped.status).json({ code: mapped.code, error: mapped.error });
  }
}
