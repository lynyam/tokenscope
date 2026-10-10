import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { EnvironmentVariables } from "../../src/config/env.validation";
import { ClientIpService } from "../../src/common/rate-limit/client-ip.service";

class TestClientIpService extends ClientIpService {
	failLookup = false;

	protected override async proxyAddresses(_host: string) {
		if (this.failLookup) {
			throw new Error("DNS unavailable");
		}

		return [{ address: "172.20.0.5", family: 4 }];
	}
}

function service(host?: string) {
	return new TestClientIpService(
		new ConfigService<EnvironmentVariables>({
			TRUSTED_PROXY_HOST: host,
		}),
	);
}

function incoming(peer: string, forwarded?: string): Request {
	return {
		socket: { remoteAddress: peer },
		headers: forwarded === undefined
			? {}
			: { "x-forwarded-for": forwarded },
	} as unknown as Request;
}

describe("Trusted client identity", () => {
	it("ignores spoofed forwarding headers in direct mode", async () => {
		await expect(
			service().getClientIp(incoming("127.0.0.1", "203.0.113.99")),
		).resolves.toBe("127.0.0.1");
	});

	it("ignores forwarding headers from an untrusted peer", async () => {
		await expect(
			service("frontend").getClientIp(
				incoming("172.20.0.9", "203.0.113.99"),
			),
		).resolves.toBe("172.20.0.9");
	});

	it("accepts one address from the configured proxy", async () => {
		await expect(
			service("frontend").getClientIp(
				incoming("::ffff:172.20.0.5", "203.0.113.9"),
			),
		).resolves.toBe("203.0.113.9");
	});

	it.each([
		undefined,
		"",
		"not-an-ip",
		"203.0.113.9, 203.0.113.10",
		" 203.0.113.9",
	])("rejects invalid trusted-proxy identity %j", async forwarded => {
		await expect(
			service("frontend").getClientIp(
				incoming("172.20.0.5", forwarded),
			),
		).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
	});

	it("fails closed when proxy resolution fails", async () => {
		const ips = service("frontend");
		ips.failLookup = true;

		await expect(
			ips.getClientIp(incoming("172.20.0.5", "203.0.113.9")),
		).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
	});
});
