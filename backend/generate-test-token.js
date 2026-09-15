require('dotenv').config();
const jwt = require('jsonwebtoken');

const payload = { sub: "7f47fe77-f3e0-412a-8c41-f6a624f10f57" };

const token = jwt.sign(payload, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: parseInt(process.env.JWT_ACCESS_TTL_SECONDS, 10),
});

console.log(token);
