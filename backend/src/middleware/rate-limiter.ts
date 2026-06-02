import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const ipCache = new Map<string, RateLimitRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipCache.entries()) {
    if (now > record.resetTime) {
      ipCache.delete(ip);
    }
  }
}, 5 * 60 * 1000);

/**
 * Lightweight in-memory rate limiting middleware to prevent malicious or misconfigured
 * agents from overloading the arena endpoints.
 * 
 * @param limit Max number of requests allowed within the window.
 * @param windowMs Time window in milliseconds.
 */
export function rateLimiter(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const record = ipCache.get(ip);

    if (!record || now > record.resetTime) {
      // Create new record or reset expired window
      ipCache.set(ip, {
        count: 1,
        resetTime: now + windowMs,
      });
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', limit - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
      return next();
    }

    record.count++;
    const remaining = Math.max(0, limit - record.count);
    
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > limit) {
      return res.status(429).json({
        error: 'Too many requests.',
        message: 'Rate limit exceeded. Please slow down and try again later.',
      });
    }

    next();
  };
}
