import { describe, expect, it } from "vitest";
import { parseHighlight } from "../web/src/ui.js";
describe("桁の強調（?hl=）", () => {
  it("範囲と 1 桁を読み、見出しをつける", () => {
    expect(parseHighlight("?hl=1-6")).toEqual({ from: 1, to: 6, caption: "Columns 1-6: sequence number" });
    expect(parseHighlight("?hl=7")).toEqual({ from: 7, to: 7, caption: "Column 7: indicator" });
    expect(parseHighlight("?hl=8-72")?.caption).toBe("Columns 8-72");
  });
  it("不正な指定は無視する", () => {
    for (const bad of ["", "?hl=0-3", "?hl=5-3", "?hl=1-81", "?hl=x"]) expect(parseHighlight(bad)).toBeUndefined();
  });
});
