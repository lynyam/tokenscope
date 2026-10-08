/**
 * Calls Gemini
 * The only file importing @google/genai: \
 * - client config (1 attempt), 
 * - streamed call, mapping of chunks, 
 * - finish reasons, 
 * - and errors to normalized events
 */