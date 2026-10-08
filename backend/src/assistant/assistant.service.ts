/**
 * + Builds the context (transaction, allowlist, 32 KiB, no-data), 
 * + then orchestrates the stream:
 *  - limits
 *  - slot
 *  - deadlines
 *  - re-checks, 
 *  - single finish()
 */