/**
 * Purpose: intercepts every incoming request (except ones marked @Public()),
            verifies the JWT and either:
            + lets the request through
            + rejects it with the correct one of three distinct 401 error codes
 */