import {
	HttpStatus,
	Injectable,
  } from "@nestjs/common";
  import { ConfigService } from "@nestjs/config";
  import { lookup } from "node:dns/promises";
  import { isIP } from "node:net";
  import type { Request } from "express";
  import type { EnvironmentVariables } from "../../config/env.validation";
  import { ApiException } from "../errors/api.exception";

  function normalizeIp(value: string): string | null {
	if (
	  value.startsWith("::ffff:") &&
	  isIP(value.slice(7)) === 4
	) {
	  return value.slice(7);
	}

	const version = isIP(value);

	if (version === 4) {
	  return value;
	}

	if (version === 6) {
	  // Normalize equivalent IPv6 spellings before using them as map keys.
	  return new URL(`http://[${value}]/`)
		.hostname.slice(1, -1)
		.toLowerCase();
	}

	return null;
  }

  @Injectable()
  export class ClientIpService {
	constructor(
	  private readonly config: ConfigService<EnvironmentVariables>,
	) {}

	async getClientIp(request: Request): Promise<string> {
	  const peer = normalizeIp(
		request.socket.remoteAddress ?? "",
	  );

	  if (!peer) {
		throw this.unavailable();
	  }

	  const proxyHost = this.config.get(
		"TRUSTED_PROXY_HOST",
		{ infer: true },
	  );

	  // Direct/local backend mode: ignore all forwarding headers.
	  if (!proxyHost) {
		return peer;
	  }

	  let addresses: Awaited<ReturnType<typeof this.proxyAddresses>>;

	  try {
		addresses = await this.proxyAddresses(proxyHost);
	  } catch {
		// A failed trust lookup must not silently enable header trust.
		throw this.unavailable();
	  }

	  const trustedPeer = addresses.some(
		address => normalizeIp(address.address) === peer,
	  );

	  if (!trustedPeer) {
		return peer;
	  }

	  const forwarded = request.headers["x-forwarded-for"];

	  // Our proxy contract is exactly one address, never a caller's chain.
	  if (
		typeof forwarded !== "string" ||
		forwarded !== forwarded.trim()
	  ) {
		throw this.unavailable();
	  }

	  const clientIp = normalizeIp(forwarded);

	  if (!clientIp) {
		throw this.unavailable();
	  }

	  return clientIp;
	}

	protected proxyAddresses(host: string) {
	  return lookup(host, { all: true });
	}

	private unavailable(): ApiException {
	  return new ApiException(
		HttpStatus.SERVICE_UNAVAILABLE,
		"SERVICE_UNAVAILABLE",
		"Client address verification is temporarily unavailable.",
	  );
	}
  }
