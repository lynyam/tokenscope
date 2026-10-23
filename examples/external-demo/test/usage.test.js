const { normalizeUsage } = require("../src/usage");

const sample = {
  promptTokenCount: 11,
  candidatesTokenCount: 18,
  thoughtsTokenCount: 375,
  totalTokenCount: 404
};

test("includes reasoning exactly once using our real response counts", () => {
  expect(normalizeUsage(sample)).toEqual({
    inputTokens: 11,
    outputTokens: 393
  });
});

test.each([
  undefined,
  {},
  { ...sample, promptTokenCount: undefined },
  { ...sample, candidatesTokenCount: undefined },
  { ...sample, totalTokenCount: undefined },
  { ...sample, thoughtsTokenCount: -1 },
  { ...sample, totalTokenCount: 403 },
  { ...sample, promptTokenCount: "11" }
])("rejects missing or inconsistent usage: %j", (usage) => {
  expect(normalizeUsage(usage)).toBeNull();
});

test("uses reported total when separate reasoning is absent", () => {
  const { thoughtsTokenCount, ...usage } = sample;
  expect(normalizeUsage(usage)).toEqual({
    inputTokens: 11,
    outputTokens: 393
  });
});

test("accepts explicitly reported zero counts", () => {
  expect(normalizeUsage({
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0
  })).toEqual({ inputTokens: 0, outputTokens: 0 });
});
