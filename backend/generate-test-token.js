require('dotenv').config();
const jwt = require('jsonwebtoken');

const payload = { sub: "cd939e51-29c7-4140-9a6a-301bf65c5fa7" };

const token = jwt.sign(payload, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: parseInt(process.env.JWT_ACCESS_TTL_SECONDS, 10),
});

console.log(token);
