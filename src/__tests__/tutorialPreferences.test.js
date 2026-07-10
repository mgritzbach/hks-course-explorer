import { describe, expect, it } from "vitest";
import {
  ALL_TUTORIAL_STORAGE_KEYS,
  skipAllTutorials,
} from "../lib/tutorialPreferences.js";

describe("skipAllTutorials", () => {
  it("marks every optional tutorial as seen", () => {
    const values = new Map();
    skipAllTutorials({ setItem: (key, value) => values.set(key, value) });

    expect(ALL_TUTORIAL_STORAGE_KEYS).not.toHaveLength(0);
    expect(
      ALL_TUTORIAL_STORAGE_KEYS.every((key) => values.get(key) === "1"),
    ).toBe(true);
  });
});
