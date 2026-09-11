require('dotenv').config();
const jwt = require('jsonwebtoken');

const payload = { sub: "test-user-id-123" };

const token = jwt.sign(payload, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: parseInt(process.env.JWT_ACCESS_TTL_SECONDS, 10),
});

console.log(token);
