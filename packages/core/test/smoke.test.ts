import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("core", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("@powerfx-ts/core");
  });
});
