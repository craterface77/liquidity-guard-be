import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { appConfig } from '../../core/env.js';

/**
 * Middleware to protect admin endpoints
 * Requires either:
 * 1. API key in Authorization header (Bearer token)
 * 2. HMAC signature from validator (x-lg-signature header)
 */
export async function adminAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Check for API key
  const authHeader = request.headers.authorization;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const validApiKey = appConfig.VALIDATOR_API_SECRET || process.env.ADMIN_API_KEY;

    if (validApiKey && token === validApiKey) {
      return; // Authorized via API key
    }
  }

  // Check for HMAC signature (from validator webhooks)
  const signature = request.headers['x-lg-signature'];
  const timestamp = request.headers['x-lg-timestamp'];

  if (signature && typeof signature === 'string') {
    const secret = appConfig.VALIDATOR_API_SECRET;
    if (!secret) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Admin endpoints require authentication'
      });
    }

    try {
      const body = JSON.stringify(request.body);
      const payload = timestamp ? `${timestamp}.${body}` : body;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (isValid) {
        // Optional: Check timestamp to prevent replay attacks
        if (timestamp && typeof timestamp === 'string') {
          const requestTime = parseInt(timestamp, 10);
          const now = Math.floor(Date.now() / 1000);
          const maxAge = 300; // 5 minutes

          if (now - requestTime > maxAge) {
            return reply.code(401).send({
              error: 'UNAUTHORIZED',
              message: 'Request timestamp too old'
            });
          }
        }

        return; // Authorized via HMAC
      }
    } catch (error) {
      // Invalid signature
    }
  }

  // No valid authentication found
  return reply.code(401).send({
    error: 'UNAUTHORIZED',
    message: 'Admin endpoints require authentication via API key or HMAC signature'
  });
}
