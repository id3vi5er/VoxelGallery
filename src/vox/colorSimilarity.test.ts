import { describe, expect, it } from "vitest";
import { colorSimilarityDistance } from "./colorSimilarity";

const metadata = (hex: string) => ({ colors: [{ hex, count: 1, index: 1 }], colorCount: 1, dominantHue: 0 });

describe("perceptual color sorting", () => {
  it("ranks an exact palette match at zero distance", () => expect(colorSimilarityDistance(metadata("#ff0000"), "#ff0000")).toBeCloseTo(0));
  it("ranks a nearby red ahead of blue", () => expect(colorSimilarityDistance(metadata("#ee2211"), "#ff0000")).toBeLessThan(colorSimilarityDistance(metadata("#0000ff"), "#ff0000")));
  it("puts models without palette metadata last", () => expect(colorSimilarityDistance(undefined, "#ffffff")).toBe(Number.POSITIVE_INFINITY));
});
