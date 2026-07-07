# Widget API

The Widget service exposes a small HTTP surface.

## Auth

Every request must carry a bearer token in the `Authorization` header. Tokens
are issued by the account service and expire after one hour.

## Rate limits

Clients are limited to 100 requests per minute per token.
