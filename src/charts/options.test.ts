import { describe, expect, it } from "vitest";
import { domainWith, frame, leftMargin } from "./options";

describe("chart option helpers", () => {
  it("domainWith overrides only the bounds that are set", () => {
    expect(domainWith([0, 10], undefined, undefined)).toEqual([0, 10]);
    expect(domainWith([0, 10], 2, undefined)).toEqual([2, 10]);
    expect(domainWith([0, 10], undefined, 5)).toEqual([0, 5]);
  });

  it("domainWith ignores an inverted or empty range", () => {
    expect(domainWith([0, 10], 8, 3)).toEqual([0, 10]);
    expect(domainWith([0, 10], 4, 4)).toEqual([0, 10]);
  });

  it("frame falls back to the container and default height", () => {
    expect(frame({}, 640, 300)).toMatchObject({ W: 640, H: 300, k: 1, titleH: 0, grid: true });
    const f = frame({ width: 900, height: 500, fontSize: 22, title: "T", grid: false }, 640, 300);
    expect(f).toMatchObject({ W: 900, H: 500, k: 2, grid: false });
    expect(f.titleH).toBeGreaterThan(0);
  });

  it("frame rejects implausibly small sizes", () => {
    expect(frame({ width: 10, height: 20 }, 640, 300)).toMatchObject({ W: 640, H: 300 });
  });

  it("leftMargin grows with font size and long tick labels", () => {
    expect(leftMargin(["10000"], 2, true)).toBeGreaterThan(leftMargin(["10000"], 1, true));
    expect(leftMargin(["1"], 1, false)).toBeLessThan(leftMargin(["1"], 1, true));
  });
});
