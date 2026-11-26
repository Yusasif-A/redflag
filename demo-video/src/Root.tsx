import { Composition } from "remotion";
import { ScamGuardDemo, TOTAL_FRAMES, FPS } from "./ScamGuardDemo";

export const Root = () => (
  <Composition
    id="ScamGuardDemo"
    component={ScamGuardDemo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
