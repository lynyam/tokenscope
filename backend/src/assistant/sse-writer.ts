/**
 * brings sse frames to http response chunk by chunl
 * (helper)
 * + Writes SSE frames
 * + Splits frames over 64 KiB
 * + Waits for drain, 
 * + Refuses writes after close
 */