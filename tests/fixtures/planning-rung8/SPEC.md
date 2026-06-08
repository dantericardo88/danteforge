# Spec: Token-Bucket Rate Limiter

1. The system MUST limit each client to 100 requests per minute using a token bucket.
2. The system MUST return HTTP 429 with a Retry-After header when a client exceeds the limit.
3. The system MUST refill tokens at a steady rate of 100 tokens per 60 seconds.
