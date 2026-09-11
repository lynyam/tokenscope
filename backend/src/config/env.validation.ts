export interface EnvironmentVariables {
	BACKEND_PORT: number;
	DATABASE_URL: string;
	JWT_SECRET: string;
	JWT_ISSUER: string;
	JWT_AUDIENCE: string;
	JWT_ACCESS_TTL_SECONDS: number;
}

function requiredString(env: Record<string, unknown>, key: string): string {
	const value = env[key];

	if (typeof value !== "string" || value.trim() === "") {
	  throw new Error(`Invalid configuration: ${key} is required.`);
	}
	return value;
  }

  function positiveInteger(env: Record<string, unknown>, key: string, max = Number.MAX_SAFE_INTEGER): number {
	const raw = requiredString(env, key);
	const value = Number(raw);

	if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max
	) {
	  throw new Error(
		`Invalid configuration: ${key} must be an integer between 1 and ${max}.`,
	  );
	}

	return value;
  }

  export function validateEnvironment(
	env: Record<string, unknown>,
  ): EnvironmentVariables {
	const port = positiveInteger(env, "BACKEND_PORT", 65535);
	const ttl = positiveInteger(env, "JWT_ACCESS_TTL_SECONDS");

	const databaseUrl = requiredString(env, "DATABASE_URL");
	let parsedUrl: URL;

	try {
	  parsedUrl = new URL(databaseUrl);
	} catch {
	  throw new Error("Invalid configuration: DATABASE_URL must be a PostgreSQL URL.");
	}

	if (
	  !["postgresql:", "postgres:"].includes(parsedUrl.protocol) ||
	  !parsedUrl.hostname ||
	  parsedUrl.pathname.length < 2 ||
	  parsedUrl.hash !== "" ||
	  databaseUrl !== databaseUrl.trim()
	) {
	  throw new Error(
		"Invalid configuration: DATABASE_URL must specify a PostgreSQL host and database.",
	  );
	}

	const secret = requiredString(env, "JWT_SECRET");

	if (
	  Buffer.byteLength(secret, "utf8") < 32 ||
	  /\s/u.test(secret) ||
	  /^(.)\1+$/u.test(secret) ||
	  /change[-_ ]?me|replace|placeholder|example/i.test(secret)
	) {
	  throw new Error(
		"Invalid configuration: JWT_SECRET must be a generated secret of at least 32 bytes, without whitespace or placeholder values.",
	  );
	}

	return {
	  BACKEND_PORT: port,
	  DATABASE_URL: databaseUrl,
	  JWT_SECRET: secret,
	  JWT_ISSUER: requiredString(env, "JWT_ISSUER"),
	  JWT_AUDIENCE: requiredString(env, "JWT_AUDIENCE"),
	  JWT_ACCESS_TTL_SECONDS: ttl,
	};
  }
