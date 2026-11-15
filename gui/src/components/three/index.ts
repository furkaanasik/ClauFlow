/*
 * Shared 3D kit (three.js / R3F). Import only from modules that are loaded
 * through next/dynamic({ ssr: false }) — this barrel pulls in three.
 * DOM-side helpers without three live in ./activity, ./webgl and ./colors.
 */
export { default as SceneCanvas } from "./SceneCanvas";
export type { SceneCanvasProps } from "./SceneCanvas";
export { SceneProvider, ToonLights, Ink, useScene, toonGradient } from "./scene";
export type { SceneClock } from "./scene";
export { buildPalette, STATION_ACCENT, mixHex } from "./palette";
export type { Palette, PaletteKey, StationKind } from "./palette";
export { useCanvasTexture, useLabelTexture, useStripeTexture, makeCanvasTexture, roundRect } from "./textures";
export { Block, RBlock, Cyl, Ball, Blob, sharedPlane } from "./parts/basics";
export { Crate, CRATE_SIZE } from "./parts/Crate";
export type { CrateHandle, CrateProps } from "./parts/Crate";
export { Conveyor } from "./parts/Conveyor";
export { RobotArm, Gear, gearGeometry, solveArm, ARM } from "./parts/RobotArm";
export type { RobotArmHandle } from "./parts/RobotArm";
export { Sparks, Scanner, StampPress, Hopper, Bin, WrappedCrate, Terminal } from "./parts/machines";
export type { ScannerDrive } from "./parts/machines";
export { DioramaBase, StationSign, paintPad } from "./parts/site";
export type { FloorPainter } from "./parts/site";
