import { describe, expect, it } from "vitest";
import { run } from "./subprocess.js";

describe("subprocess runner", () => {
  it("returns stdout even when stderr contains probe warnings", async () => {
    const output = await run(
      process.execPath,
      [
        "-e",
        "process.stderr.write('[mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] warning\\n');process.stdout.write('{\"format\":{\"duration\":\"12.34\"}}');"
      ],
      true
    );

    expect(output).toBe("{\"format\":{\"duration\":\"12.34\"}}");
  });

  it("surfaces stderr when the command fails", async () => {
    await expect(
      run(
        process.execPath,
        ["-e", "process.stderr.write('transcode failed');process.exit(7);"],
        true
      )
    ).rejects.toThrow("transcode failed");
  });
});
